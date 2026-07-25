import type { SQLiteDatabase } from 'expo-sqlite';
import { MIGRATIONS } from './schema';
import type { LocalStore } from '../core/ports';
import type {
  Order,
  OrderItem,
  OrderStatus,
  OutboxEntry,
  ReviewSnapshot,
  StatusChange,
  StatusChangePayload,
} from '../core/types';

interface OrderRow {
  id: string;
  reference: string;
  customer_name: string;
  customer_phone: string;
  address: string;
  delivery_window: string;
  notes: string | null;
  items_json: string;
  status: string;
  version: number;
  created_at: number;
  updated_at: number;
  needs_review: number;
  review_json: string | null;
}

interface OutboxRow {
  id: string;
  order_id: string;
  operation: string;
  payload_json: string;
  created_at: number;
  attempts: number;
  next_attempt_at: number;
  last_error: string | null;
}

interface ChangeRow {
  id: string;
  order_id: string;
  status: string;
  recorded_at: number;
  failure_json: string | null;
  proof_json: string | null;
  synced: number;
}

export async function migrate(db: SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;

  for (let version = current; version < MIGRATIONS.length; version += 1) {
    await db.execAsync(MIGRATIONS[version]!);
  }
  if (current < MIGRATIONS.length) {
    await db.execAsync(`PRAGMA user_version = ${MIGRATIONS.length}`);
  }
}

function toOrder(row: OrderRow): Order {
  return {
    id: row.id,
    reference: row.reference,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    address: row.address,
    deliveryWindow: row.delivery_window,
    notes: row.notes ?? undefined,
    items: JSON.parse(row.items_json) as OrderItem[],
    status: row.status as OrderStatus,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    needsReview: row.needs_review === 1,
    reviewSnapshot: row.review_json ? (JSON.parse(row.review_json) as ReviewSnapshot) : undefined,
  };
}

function toOutboxEntry(row: OutboxRow): OutboxEntry {
  return {
    id: row.id,
    orderId: row.order_id,
    operation: 'status_change',
    payload: JSON.parse(row.payload_json) as StatusChangePayload,
    createdAt: row.created_at,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    lastError: row.last_error ?? undefined,
  };
}

const UPSERT_ORDER = `
  INSERT INTO orders (
    id, reference, customer_name, customer_phone, address, delivery_window,
    notes, items_json, status, version, created_at, updated_at, needs_review, review_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    reference = excluded.reference,
    customer_name = excluded.customer_name,
    customer_phone = excluded.customer_phone,
    address = excluded.address,
    delivery_window = excluded.delivery_window,
    notes = excluded.notes,
    items_json = excluded.items_json,
    status = excluded.status,
    version = excluded.version,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at,
    needs_review = excluded.needs_review,
    review_json = excluded.review_json
`;

function orderParams(order: Order) {
  return [
    order.id,
    order.reference,
    order.customerName,
    order.customerPhone,
    order.address,
    order.deliveryWindow,
    order.notes ?? null,
    JSON.stringify(order.items),
    order.status,
    order.version,
    order.createdAt,
    order.updatedAt,
    order.needsReview ? 1 : 0,
    order.reviewSnapshot ? JSON.stringify(order.reviewSnapshot) : null,
  ];
}

/**
 * The expo-sqlite implementation of the LocalStore port.
 *
 * Everything the sync engine knows about storage is the interface in
 * core/ports.ts; this file is the only place SQL appears, and swapping it out
 * would not require the engine or its tests to change.
 */
export class SqliteStore implements LocalStore {
  constructor(private readonly db: SQLiteDatabase) {}

  async getOrders(): Promise<Order[]> {
    const rows = await this.db.getAllAsync<OrderRow>(
      'SELECT * FROM orders ORDER BY updated_at DESC',
    );
    return rows.map(toOrder);
  }

  async getOrder(id: string): Promise<Order | null> {
    const row = await this.db.getFirstAsync<OrderRow>('SELECT * FROM orders WHERE id = ?', id);
    return row ? toOrder(row) : null;
  }

  async upsertOrders(orders: Order[]): Promise<void> {
    if (orders.length === 0) return;
    await this.db.withTransactionAsync(async () => {
      for (const order of orders) {
        await this.db.runAsync(UPSERT_ORDER, orderParams(order));
      }
    });
  }

  async replaceOrder(order: Order): Promise<void> {
    await this.db.runAsync(UPSERT_ORDER, orderParams(order));
  }

  async getStatusHistory(orderId: string): Promise<StatusChange[]> {
    const rows = await this.db.getAllAsync<ChangeRow>(
      'SELECT * FROM status_changes WHERE order_id = ? ORDER BY recorded_at DESC',
      orderId,
    );
    return rows.map((row) => ({
      id: row.id,
      orderId: row.order_id,
      status: row.status as OrderStatus,
      recordedAt: row.recorded_at,
      failure: row.failure_json ? JSON.parse(row.failure_json) : undefined,
      proof: row.proof_json ? JSON.parse(row.proof_json) : undefined,
      synced: row.synced === 1,
    }));
  }

  /**
   * The atomic write at the heart of the app. If the optimistic order update
   * committed but the outbox insert did not, the driver would see a delivered
   * order that the server will never hear about. One transaction removes that
   * window entirely.
   */
  async commitStatusChange(input: {
    order: Order;
    change: StatusChange;
    outboxEntry: OutboxEntry;
  }): Promise<void> {
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync(UPSERT_ORDER, orderParams(input.order));
      await this.db.runAsync(
        `INSERT INTO status_changes (id, order_id, status, recorded_at, failure_json, proof_json, synced)
         VALUES (?, ?, ?, ?, ?, ?, 0)`,
        [
          input.change.id,
          input.change.orderId,
          input.change.status,
          input.change.recordedAt,
          input.change.failure ? JSON.stringify(input.change.failure) : null,
          input.change.proof ? JSON.stringify(input.change.proof) : null,
        ],
      );
      await this.db.runAsync(
        `INSERT INTO outbox (id, order_id, operation, payload_json, created_at, attempts, next_attempt_at)
         VALUES (?, ?, ?, ?, ?, 0, ?)`,
        [
          input.outboxEntry.id,
          input.outboxEntry.orderId,
          input.outboxEntry.operation,
          JSON.stringify(input.outboxEntry.payload),
          input.outboxEntry.createdAt,
          input.outboxEntry.nextAttemptAt,
        ],
      );
    });
  }

  async getDueOutboxEntries(now: number, limit: number): Promise<OutboxEntry[]> {
    const rows = await this.db.getAllAsync<OutboxRow>(
      'SELECT * FROM outbox WHERE next_attempt_at <= ? ORDER BY created_at ASC LIMIT ?',
      [now, limit],
    );
    return rows.map(toOutboxEntry);
  }

  async getAllOutboxEntries(): Promise<OutboxEntry[]> {
    const rows = await this.db.getAllAsync<OutboxRow>(
      'SELECT * FROM outbox ORDER BY created_at ASC',
    );
    return rows.map(toOutboxEntry);
  }

  async countPending(): Promise<number> {
    const row = await this.db.getFirstAsync<{ n: number }>('SELECT COUNT(*) as n FROM outbox');
    return row?.n ?? 0;
  }

  async removeOutboxEntry(id: string): Promise<void> {
    await this.db.runAsync('DELETE FROM outbox WHERE id = ?', id);
  }

  async recordAttempt(id: string, nextAttemptAt: number, error: string): Promise<void> {
    await this.db.runAsync(
      'UPDATE outbox SET attempts = attempts + 1, next_attempt_at = ?, last_error = ? WHERE id = ?',
      [nextAttemptAt, error, id],
    );
  }

  async rebaseOutboxEntry(id: string, baseVersion: number): Promise<void> {
    const row = await this.db.getFirstAsync<OutboxRow>('SELECT * FROM outbox WHERE id = ?', id);
    if (!row) return;
    const payload = { ...(JSON.parse(row.payload_json) as StatusChangePayload), baseVersion };
    await this.db.runAsync('UPDATE outbox SET payload_json = ? WHERE id = ?', [
      JSON.stringify(payload),
      id,
    ]);
  }

  async markChangeSynced(changeId: string): Promise<void> {
    await this.db.runAsync('UPDATE status_changes SET synced = 1 WHERE id = ?', changeId);
  }

  async flagForReview(orderId: string, snapshot: ReviewSnapshot): Promise<void> {
    await this.db.runAsync('UPDATE orders SET needs_review = 1, review_json = ? WHERE id = ?', [
      JSON.stringify(snapshot),
      orderId,
    ]);
  }

  async clearReview(orderId: string): Promise<void> {
    await this.db.runAsync(
      'UPDATE orders SET needs_review = 0, review_json = NULL WHERE id = ?',
      orderId,
    );
  }

  async getWatermark(): Promise<number | null> {
    const row = await this.db.getFirstAsync<{ value: string }>(
      "SELECT value FROM meta WHERE key = 'watermark'",
    );
    return row ? Number(row.value) : null;
  }

  async setWatermark(value: number): Promise<void> {
    await this.db.runAsync(
      "INSERT INTO meta (key, value) VALUES ('watermark', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      String(value),
    );
  }
}
