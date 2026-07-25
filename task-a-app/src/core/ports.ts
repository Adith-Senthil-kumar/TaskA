import type {
  ConnectionState,
  Order,
  OutboxEntry,
  ReviewSnapshot,
  StatusChange,
  StatusChangePayload,
} from './types';

/**
 * Ports. Every dependency the sync engine has on the outside world is declared
 * here as an interface, so the engine can be driven by SQLite and fetch in the
 * app, and by in-memory fakes in the tests, with no branching inside the engine
 * itself.
 */

export interface Clock {
  now(): number;
}

export interface ConnectivityMonitor {
  getState(): ConnectionState;
  subscribe(listener: (state: ConnectionState) => void): () => void;
}

/** Result of pushing one outbox entry to the server. */
export type PushResult =
  | { kind: 'applied'; order: Order }
  /** Server refused because its version moved on. Carries the server's truth. */
  | { kind: 'conflict'; serverOrder: Order }
  /** Network or 5xx. Safe and correct to retry. */
  | { kind: 'transient'; message: string }
  /** 4xx that retrying cannot fix. Entry must leave the queue. */
  | { kind: 'permanent'; message: string };

export interface OrderApi {
  /** Pull orders changed since a watermark. Null pulls everything. */
  fetchOrders(since: number | null): Promise<Order[]>;
  /**
   * @param idempotencyKey The outbox entry id. The server must treat a repeat
   * of the same key as the same logical write, because a response can be lost
   * after the server has already committed.
   */
  pushStatusChange(
    orderId: string,
    payload: StatusChangePayload,
    idempotencyKey: string,
  ): Promise<PushResult>;
}

/**
 * The local database. The app reads only from here - never directly from the
 * API - which is what makes every screen work offline by construction rather
 * than by remembering to add a cache.
 */
export interface LocalStore {
  getOrders(): Promise<Order[]>;
  getOrder(id: string): Promise<Order | null>;
  upsertOrders(orders: Order[]): Promise<void>;
  replaceOrder(order: Order): Promise<void>;

  getStatusHistory(orderId: string): Promise<StatusChange[]>;

  /**
   * Writes the optimistic local order state, the history entry and the outbox
   * entry in a single transaction. If this were three separate writes, a crash
   * between them would leave the driver looking at a delivered order that will
   * never be sent - the exact failure offline-first is supposed to prevent.
   */
  commitStatusChange(input: {
    order: Order;
    change: StatusChange;
    outboxEntry: OutboxEntry;
  }): Promise<void>;

  getDueOutboxEntries(now: number, limit: number): Promise<OutboxEntry[]>;
  getAllOutboxEntries(): Promise<OutboxEntry[]>;
  countPending(): Promise<number>;
  removeOutboxEntry(id: string): Promise<void>;
  recordAttempt(id: string, nextAttemptAt: number, error: string): Promise<void>;
  /**
   * Rewrites the base version a queued change is built on, after the server has
   * told us its version moved. This is a real write rather than an in-place
   * mutation of a returned object, because entries read out of SQLite are
   * copies - mutating them would work in memory and silently lose the rebase on
   * device.
   */
  rebaseOutboxEntry(id: string, baseVersion: number): Promise<void>;
  markChangeSynced(changeId: string): Promise<void>;

  flagForReview(orderId: string, snapshot: ReviewSnapshot): Promise<void>;
  clearReview(orderId: string): Promise<void>;

  getWatermark(): Promise<number | null>;
  setWatermark(value: number): Promise<void>;
}

export interface IdGenerator {
  next(): string;
}
