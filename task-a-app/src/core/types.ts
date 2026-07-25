/**
 * Domain types for Lastmile.
 *
 * Nothing in src/core imports React or React Native. The whole offline/sync
 * layer is plain TypeScript behind the ports in ./ports.ts, which is why the
 * tests in __tests__/core run in a plain Node environment with no simulator,
 * no Metro bundler and no mocking of native modules.
 */

export type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'in_transit'
  | 'delivered'
  | 'failed';

export type FailureReason =
  | 'nobody_home'
  | 'refused'
  | 'access_problem'
  | 'damaged';

export interface OrderItem {
  sku: string;
  name: string;
  quantity: number;
}

/** Why a status change could not be completed, captured at the doorstep. */
export interface FailureDetail {
  reason: FailureReason;
  notes?: string;
}

/** Proof of delivery captured on device. */
export interface DeliveryProof {
  recipientName?: string;
  /** Local file URI. Photos upload separately from the status change itself. */
  photoUri?: string;
}

export interface StatusChange {
  id: string;
  orderId: string;
  status: OrderStatus;
  /** Device clock. Never trusted for conflict resolution - see conflict.ts. */
  recordedAt: number;
  failure?: FailureDetail;
  proof?: DeliveryProof;
  /** False until the server has acknowledged this change. */
  synced: boolean;
}

export interface Order {
  id: string;
  reference: string;
  customerName: string;
  customerPhone: string;
  address: string;
  deliveryWindow: string;
  notes?: string;
  items: OrderItem[];
  status: OrderStatus;
  /**
   * Server-assigned, monotonically increasing. Used to detect that the local
   * copy is stale before a push is attempted.
   */
  version: number;
  /** When dispatch raised the order. Server-assigned and never changes. */
  createdAt: number;
  updatedAt: number;
  /** True when local state has diverged and a human must choose. */
  needsReview: boolean;
  /** The server's version of this order at the moment review was triggered. */
  reviewSnapshot?: ReviewSnapshot;
}

export interface ReviewSnapshot {
  serverStatus: OrderStatus;
  serverVersion: number;
  serverUpdatedAt: number;
  localStatus: OrderStatus;
  localRecordedAt: number;
}

export type OutboxOperation = 'status_change';

export interface OutboxEntry {
  /** Also used as the idempotency key sent to the server. */
  id: string;
  orderId: string;
  operation: OutboxOperation;
  payload: StatusChangePayload;
  createdAt: number;
  attempts: number;
  /** Epoch ms before which this entry must not be retried. */
  nextAttemptAt: number;
  lastError?: string;
}

export interface StatusChangePayload {
  status: OrderStatus;
  recordedAt: number;
  /** Version the device believed was current when the driver acted. */
  baseVersion: number;
  failure?: FailureDetail;
  proof?: DeliveryProof;
}

export type ConnectionState = 'online' | 'offline';

export type SyncPhase = 'idle' | 'syncing' | 'error';

export interface SyncStatus {
  phase: SyncPhase;
  connection: ConnectionState;
  pendingCount: number;
  reviewCount: number;
  lastSyncedAt: number | null;
  lastError: string | null;
}
