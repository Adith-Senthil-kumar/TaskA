import { randomUUID } from 'node:crypto';
import type {
  Clock,
  ConnectivityMonitor,
  IdGenerator,
  LocalStore,
  OrderApi,
  PushResult,
} from '../../src/core/ports';
import type {
  ConnectionState,
  Order,
  OutboxEntry,
  ReviewSnapshot,
  StatusChange,
  StatusChangePayload,
} from '../../src/core/types';

export class FakeClock implements Clock {
  constructor(private t = 1_700_000_000_000) {}
  now(): number {
    return this.t;
  }
  advance(ms: number): void {
    this.t += ms;
  }
  set(ms: number): void {
    this.t = ms;
  }
}

export class FakeConnectivity implements ConnectivityMonitor {
  private listeners = new Set<(s: ConnectionState) => void>();
  constructor(private state: ConnectionState = 'online') {}
  getState(): ConnectionState {
    return this.state;
  }
  subscribe(listener: (s: ConnectionState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  set(state: ConnectionState): void {
    this.state = state;
    for (const l of this.listeners) l(state);
  }
}

/** Deterministic ids for unit tests, where readable output matters. */
export class SeqIds implements IdGenerator {
  private n = 0;
  constructor(private readonly prefix = 'id') {}
  next(): string {
    this.n += 1;
    return `${this.prefix}-${this.n}`;
  }
}

/**
 * Globally unique ids, used wherever a real server is involved.
 *
 * This exists because the integration suite originally used SeqIds and two
 * separate engines both produced "id-1". The mock server did exactly what an
 * idempotent server should - replayed the first response instead of writing
 * again - and a test failed. The bug was in the key generator, not the server,
 * which is precisely why production uses randomUUID.
 */
export class UuidIds implements IdGenerator {
  next(): string {
    return randomUUID();
  }
}

export class InMemoryStore implements LocalStore {
  orders = new Map<string, Order>();
  outbox: OutboxEntry[] = [];
  history: StatusChange[] = [];
  watermark: number | null = null;
  /** Set true to assert that commitStatusChange is atomic in callers' eyes. */
  failNextCommit = false;

  constructor(seed: Order[] = []) {
    for (const o of seed) this.orders.set(o.id, o);
  }

  async getOrders(): Promise<Order[]> {
    return [...this.orders.values()];
  }
  async getOrder(id: string): Promise<Order | null> {
    return this.orders.get(id) ?? null;
  }
  async upsertOrders(orders: Order[]): Promise<void> {
    for (const o of orders) this.orders.set(o.id, o);
  }
  async replaceOrder(order: Order): Promise<void> {
    this.orders.set(order.id, order);
  }
  async getStatusHistory(orderId: string): Promise<StatusChange[]> {
    return this.history.filter((h) => h.orderId === orderId);
  }

  async commitStatusChange(input: {
    order: Order;
    change: StatusChange;
    outboxEntry: OutboxEntry;
  }): Promise<void> {
    if (this.failNextCommit) {
      this.failNextCommit = false;
      throw new Error('disk full');
    }
    this.orders.set(input.order.id, input.order);
    this.history.push(input.change);
    this.outbox.push(input.outboxEntry);
  }

  async getDueOutboxEntries(now: number, limit: number): Promise<OutboxEntry[]> {
    return this.outbox
      .filter((e) => e.nextAttemptAt <= now)
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, limit);
  }
  async getAllOutboxEntries(): Promise<OutboxEntry[]> {
    return [...this.outbox];
  }
  async countPending(): Promise<number> {
    return this.outbox.length;
  }
  async removeOutboxEntry(id: string): Promise<void> {
    this.outbox = this.outbox.filter((e) => e.id !== id);
  }
  async recordAttempt(id: string, nextAttemptAt: number, error: string): Promise<void> {
    const entry = this.outbox.find((e) => e.id === id);
    if (entry) {
      entry.attempts += 1;
      entry.nextAttemptAt = nextAttemptAt;
      entry.lastError = error;
    }
  }
  async rebaseOutboxEntry(id: string, baseVersion: number): Promise<void> {
    const entry = this.outbox.find((e) => e.id === id);
    if (entry) entry.payload = { ...entry.payload, baseVersion };
  }
  async markChangeSynced(changeId: string): Promise<void> {
    const change = this.history.find((h) => h.id === changeId);
    if (change) change.synced = true;
  }
  async flagForReview(orderId: string, snapshot: ReviewSnapshot): Promise<void> {
    const order = this.orders.get(orderId);
    if (order) this.orders.set(orderId, { ...order, needsReview: true, reviewSnapshot: snapshot });
  }
  async clearReview(orderId: string): Promise<void> {
    const order = this.orders.get(orderId);
    if (order) {
      this.orders.set(orderId, { ...order, needsReview: false, reviewSnapshot: undefined });
    }
  }
  async getWatermark(): Promise<number | null> {
    return this.watermark;
  }
  async setWatermark(value: number): Promise<void> {
    this.watermark = value;
  }
}

type PushCall = { orderId: string; payload: StatusChangePayload; key: string };

export class FakeApi implements OrderApi {
  calls: PushCall[] = [];
  fetched: (number | null)[] = [];
  private queue: PushResult[] = [];
  private fallback: PushResult | null = null;
  remoteOrders: Order[] = [];

  /** Queue results consumed one per push, in order. */
  program(...results: PushResult[]): void {
    this.queue.push(...results);
  }
  always(result: PushResult): void {
    this.fallback = result;
  }

  async fetchOrders(since: number | null): Promise<Order[]> {
    this.fetched.push(since);
    return this.remoteOrders;
  }

  async pushStatusChange(
    orderId: string,
    payload: StatusChangePayload,
    key: string,
  ): Promise<PushResult> {
    this.calls.push({ orderId, payload: { ...payload }, key });
    const next = this.queue.shift();
    if (next) return next;
    if (this.fallback) return this.fallback;
    throw new Error('FakeApi received an unprogrammed call');
  }
}

export function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'o1',
    reference: '#4417',
    customerName: 'R. Iyer',
    customerPhone: '+44 7700 900001',
    address: '14 Brunswick Rd',
    deliveryWindow: '09:00-12:00',
    items: [{ sku: 'SKU-1', name: 'Box', quantity: 1 }],
    status: 'in_transit',
    version: 3,
    createdAt: 1_699_995_400_000,
    updatedAt: 1_699_999_000_000,
    needsReview: false,
    ...overrides,
  };
}
