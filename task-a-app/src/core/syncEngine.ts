import { backoffDelay, hasExhaustedRetries } from './backoff';
import { buildReviewSnapshot, mergePulledOrder, resolveStatusConflict } from './conflict';
import { canTransition } from './statusMachine';
import type {
  Clock,
  ConnectivityMonitor,
  IdGenerator,
  LocalStore,
  OrderApi,
} from './ports';
import type {
  ConnectionState,
  DeliveryProof,
  FailureDetail,
  Order,
  OrderStatus,
  OutboxEntry,
  StatusChange,
  StatusChangePayload,
  SyncStatus,
} from './types';

export interface SyncEngineDeps {
  store: LocalStore;
  api: OrderApi;
  clock: Clock;
  connectivity: ConnectivityMonitor;
  ids: IdGenerator;
  /** Injected so backoff jitter is deterministic under test. */
  random?: () => number;
  /** How many entries one flush pass will attempt. */
  batchSize?: number;
  /**
   * Whether committing a change should immediately try to send it. True in the
   * app; tests turn it off so a pass can be driven deliberately rather than
   * racing a background one.
   */
  autoFlush?: boolean;
}

export interface FlushReport {
  attempted: number;
  applied: number;
  deferred: number;
  conflicted: number;
  failed: number;
  skippedOffline: boolean;
}

export interface StatusChangeInput {
  orderId: string;
  status: OrderStatus;
  failure?: FailureDetail;
  proof?: DeliveryProof;
}

export class TransitionNotAllowedError extends Error {
  constructor(from: OrderStatus, to: OrderStatus) {
    super(`Cannot move an order from "${from}" to "${to}".`);
    this.name = 'TransitionNotAllowedError';
  }
}

export class OrderNotFoundError extends Error {
  constructor(orderId: string) {
    super(`Order ${orderId} is not in the local database.`);
    this.name = 'OrderNotFoundError';
  }
}

/**
 * The sync engine.
 *
 * Two rules govern everything here:
 *
 * 1. The local database is the source of truth for the UI. A driver's action is
 *    committed locally and acknowledged on screen before the network is
 *    consulted at all, so the app behaves identically with and without signal.
 *
 * 2. Nothing is ever silently dropped. Every path that removes work from the
 *    outbox either applies it, supersedes it under a stated rule, or escalates
 *    it to the driver. There is no branch that discards a change quietly.
 */
export class SyncEngine {
  private readonly store: LocalStore;
  private readonly api: OrderApi;
  private readonly clock: Clock;
  private readonly connectivity: ConnectivityMonitor;
  private readonly ids: IdGenerator;
  private readonly random: () => number;
  private readonly batchSize: number;

  private inFlight: Promise<FlushReport> | null = null;
  /**
   * A pull that failed must keep the status in `error` even when the flush that
   * follows it has nothing to send. Without this, an unreachable server reads as
   * "All caught up" - the queue really is empty, so the flush really did
   * succeed - and the driver is told the opposite of the truth.
   */
  private pullFailed = false;
  private readonly autoFlush: boolean;
  private unsubscribe: (() => void) | null = null;
  private listeners = new Set<(status: SyncStatus) => void>();

  private status: SyncStatus = {
    phase: 'idle',
    connection: 'offline',
    pendingCount: 0,
    reviewCount: 0,
    lastSyncedAt: null,
    lastError: null,
  };

  constructor(deps: SyncEngineDeps) {
    this.store = deps.store;
    this.api = deps.api;
    this.clock = deps.clock;
    this.connectivity = deps.connectivity;
    this.ids = deps.ids;
    this.random = deps.random ?? Math.random;
    this.batchSize = deps.batchSize ?? 25;
    this.autoFlush = deps.autoFlush ?? true;
    this.status.connection = this.connectivity.getState();
  }

  // ---------------------------------------------------------------- lifecycle

  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.connectivity.subscribe((state) => {
      const wasOffline = this.status.connection === 'offline';
      this.patchStatus({ connection: state });
      // Regaining signal is the trigger. There is no polling timer, because a
      // driver in a dead zone should not be burning battery on doomed requests.
      if (state === 'online' && wasOffline) {
        void this.sync();
      }
    });
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  subscribe(listener: (status: SyncStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  getStatus(): SyncStatus {
    return this.status;
  }

  // ------------------------------------------------------------------- writes

  /**
   * Records a status change. Returns as soon as the local transaction commits;
   * the network attempt is incidental to the driver's experience.
   */
  async recordStatusChange(input: StatusChangeInput): Promise<Order> {
    const order = await this.store.getOrder(input.orderId);
    if (!order) throw new OrderNotFoundError(input.orderId);

    if (!canTransition(order.status, input.status)) {
      throw new TransitionNotAllowedError(order.status, input.status);
    }

    const now = this.clock.now();

    const change: StatusChange = {
      id: this.ids.next(),
      orderId: order.id,
      status: input.status,
      recordedAt: now,
      failure: input.failure,
      proof: input.proof,
      synced: false,
    };

    const payload: StatusChangePayload = {
      status: input.status,
      recordedAt: now,
      baseVersion: order.version,
      failure: input.failure,
      proof: input.proof,
    };

    const entry: OutboxEntry = {
      id: change.id,
      orderId: order.id,
      operation: 'status_change',
      payload,
      createdAt: now,
      attempts: 0,
      nextAttemptAt: now,
    };

    const optimistic: Order = {
      ...order,
      status: input.status,
      updatedAt: now,
    };

    await this.store.commitStatusChange({ order: optimistic, change, outboxEntry: entry });
    await this.refreshCounts();

    if (this.autoFlush && this.connectivity.getState() === 'online') {
      void this.flush();
    }

    return optimistic;
  }

  // -------------------------------------------------------------------- sync

  async sync(): Promise<FlushReport> {
    await this.pull();
    return this.flush();
  }

  async pull(): Promise<void> {
    if (this.connectivity.getState() === 'offline') return;

    this.patchStatus({ phase: 'syncing' });
    try {
      const since = await this.store.getWatermark();
      const remote = await this.api.fetchOrders(since);

      const merged: Order[] = [];
      for (const incoming of remote) {
        const local = await this.store.getOrder(incoming.id);
        merged.push(mergePulledOrder(local, incoming));
      }

      if (merged.length > 0) {
        await this.store.upsertOrders(merged);
        await this.store.setWatermark(
          merged.reduce((max, o) => Math.max(max, o.updatedAt), since ?? 0),
        );
      }
      this.pullFailed = false;
      this.patchStatus({ phase: 'idle', lastError: null });
    } catch (error) {
      this.pullFailed = true;
      this.patchStatus({ phase: 'error', lastError: describeError(error) });
    } finally {
      await this.refreshCounts();
    }
  }

  /**
   * Drains the outbox.
   *
   * Entries are processed oldest-first, and if one entry for an order cannot be
   * sent, every later entry for that same order is left alone for this pass.
   * Without that, a driver who marks an order in transit and then delivered
   * while offline could have the delivery land before the dispatch, and the
   * server's history would describe a journey that never happened.
   */
  async flush(): Promise<FlushReport> {
    const report: FlushReport = {
      attempted: 0,
      applied: 0,
      deferred: 0,
      conflicted: 0,
      failed: 0,
      skippedOffline: false,
    };

    if (this.connectivity.getState() === 'offline') {
      report.skippedOffline = true;
      return report;
    }
    // A second flush racing the first would double-send entries the first pass
    // has read but not yet resolved. Callers join the pass already running
    // rather than being told "nothing happened", which would be a lie.
    if (this.inFlight) return this.inFlight;

    this.inFlight = this.runFlush(report);
    return this.inFlight;
  }

  private async runFlush(report: FlushReport): Promise<FlushReport> {
    this.patchStatus({ phase: 'syncing' });

    try {
      const now = this.clock.now();
      const due = await this.store.getDueOutboxEntries(now, this.batchSize);
      const blockedOrders = new Set<string>();

      for (const entry of due) {
        if (blockedOrders.has(entry.orderId)) {
          report.deferred += 1;
          continue;
        }
        if (this.connectivity.getState() === 'offline') {
          report.skippedOffline = true;
          break;
        }

        report.attempted += 1;
        const outcome = await this.processEntry(entry);

        switch (outcome) {
          case 'applied':
            report.applied += 1;
            break;
          case 'deferred':
            report.deferred += 1;
            blockedOrders.add(entry.orderId);
            break;
          case 'conflicted':
            report.conflicted += 1;
            break;
          case 'failed':
            report.failed += 1;
            blockedOrders.add(entry.orderId);
            break;
        }
      }

      const pending = await this.store.countPending();
      this.patchStatus({
        phase: report.failed > 0 || this.pullFailed ? 'error' : 'idle',
        pendingCount: pending,
        lastSyncedAt: report.applied > 0 ? this.clock.now() : this.status.lastSyncedAt,
      });
      return report;
    } finally {
      this.inFlight = null;
      await this.refreshCounts();
    }
  }

  private async processEntry(
    entry: OutboxEntry,
  ): Promise<'applied' | 'deferred' | 'conflicted' | 'failed'> {
    let result;
    try {
      result = await this.api.pushStatusChange(entry.orderId, entry.payload, entry.id);
    } catch (error) {
      return this.deferEntry(entry, describeError(error));
    }

    switch (result.kind) {
      case 'applied': {
        await this.store.replaceOrder(result.order);
        await this.store.markChangeSynced(entry.id);
        await this.store.removeOutboxEntry(entry.id);
        return 'applied';
      }

      case 'transient':
        return this.deferEntry(entry, result.message);

      case 'permanent': {
        // Retrying will never help, but the driver's work must not vanish.
        await this.store.removeOutboxEntry(entry.id);
        const current = await this.store.getOrder(entry.orderId);
        if (current) {
          await this.store.flagForReview(
            entry.orderId,
            buildReviewSnapshot(current, entry.payload.status, entry.payload.recordedAt),
          );
        }
        this.patchStatus({ lastError: result.message });
        return 'failed';
      }

      case 'conflict': {
        const outcome = resolveStatusConflict({
          localStatus: entry.payload.status,
          serverStatus: result.serverOrder.status,
        });

        if (outcome.resolution === 'take_server') {
          await this.store.replaceOrder(result.serverOrder);
          await this.store.removeOutboxEntry(entry.id);
          return 'conflicted';
        }

        if (outcome.resolution === 'needs_review') {
          await this.store.replaceOrder({
            ...result.serverOrder,
            needsReview: true,
            reviewSnapshot: buildReviewSnapshot(
              result.serverOrder,
              entry.payload.status,
              entry.payload.recordedAt,
            ),
          });
          await this.store.removeOutboxEntry(entry.id);
          return 'conflicted';
        }

        // keep_local: rebase onto the server's version and let the next pass
        // send it. Rebasing rather than force-writing means we never overwrite
        // a field we did not look at.
        await this.store.recordAttempt(
          entry.id,
          this.clock.now(),
          outcome.reason,
        );
        await this.rebaseEntry(entry, result.serverOrder.version);
        return 'deferred';
      }
    }
  }

  private async rebaseEntry(entry: OutboxEntry, version: number): Promise<void> {
    const order = await this.store.getOrder(entry.orderId);
    if (order) {
      await this.store.replaceOrder({ ...order, version });
    }
    await this.store.rebaseOutboxEntry(entry.id, version);
  }

  private async deferEntry(
    entry: OutboxEntry,
    message: string,
  ): Promise<'deferred' | 'failed'> {
    const attempts = entry.attempts + 1;

    if (hasExhaustedRetries(attempts)) {
      await this.store.removeOutboxEntry(entry.id);
      const current = await this.store.getOrder(entry.orderId);
      if (current) {
        await this.store.flagForReview(
          entry.orderId,
          buildReviewSnapshot(current, entry.payload.status, entry.payload.recordedAt),
        );
      }
      this.patchStatus({ lastError: `Gave up after ${attempts} attempts: ${message}` });
      return 'failed';
    }

    const nextAttemptAt = this.clock.now() + backoffDelay(attempts, this.random);
    await this.store.recordAttempt(entry.id, nextAttemptAt, message);
    this.patchStatus({ lastError: message });
    return 'deferred';
  }

  // ------------------------------------------------------------------ review

  /**
   * A human has decided what actually happened. Their answer re-enters the
   * queue as an ordinary change so it takes the same path as any other write.
   */
  async resolveReview(orderId: string, chosen: OrderStatus): Promise<void> {
    const order = await this.store.getOrder(orderId);
    if (!order) throw new OrderNotFoundError(orderId);

    await this.store.clearReview(orderId);

    if (order.status === chosen) {
      await this.refreshCounts();
      return;
    }

    const now = this.clock.now();
    const change: StatusChange = {
      id: this.ids.next(),
      orderId,
      status: chosen,
      recordedAt: now,
      synced: false,
    };

    await this.store.commitStatusChange({
      order: { ...order, status: chosen, updatedAt: now, needsReview: false },
      change,
      outboxEntry: {
        id: change.id,
        orderId,
        operation: 'status_change',
        payload: { status: chosen, recordedAt: now, baseVersion: order.version },
        createdAt: now,
        attempts: 0,
        nextAttemptAt: now,
      },
    });

    await this.refreshCounts();
    if (this.autoFlush && this.connectivity.getState() === 'online') void this.flush();
  }

  // ----------------------------------------------------------------- private

  private async refreshCounts(): Promise<void> {
    const [pendingCount, orders] = await Promise.all([
      this.store.countPending(),
      this.store.getOrders(),
    ]);
    this.patchStatus({
      pendingCount,
      reviewCount: orders.filter((o) => o.needsReview).length,
    });
  }

  private patchStatus(patch: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const listener of this.listeners) listener(this.status);
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export type { ConnectionState };
