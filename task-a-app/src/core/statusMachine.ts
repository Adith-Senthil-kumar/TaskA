import type { OrderStatus } from './types';

/**
 * Delivery is a one-way process. An order that has left the depot cannot become
 * un-dispatched, and a parcel that has been handed over cannot become pending
 * again. Encoding that as a rank is what lets conflict resolution be automatic
 * for almost every disagreement - see conflict.ts.
 *
 * `delivered` and `failed` share rank 3 deliberately: both are terminal, and
 * neither supersedes the other. That single shared rank is the reason the app
 * ever has to ask a human anything.
 */
export const STATUS_RANK: Record<OrderStatus, number> = {
  pending: 0,
  confirmed: 1,
  in_transit: 2,
  delivered: 3,
  failed: 3,
};

export const TERMINAL_STATUSES: readonly OrderStatus[] = ['delivered', 'failed'];

export function isTerminal(status: OrderStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function rankOf(status: OrderStatus): number {
  return STATUS_RANK[status];
}

/**
 * Transitions the UI is allowed to offer. Stricter than the conflict rule:
 * a driver may only move an order forward one meaningful step at a time, but
 * the sync layer must still cope with any pair of statuses arriving in any
 * order, because two devices can act independently while offline.
 */
const ALLOWED_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ['confirmed', 'failed'],
  confirmed: ['in_transit', 'failed'],
  in_transit: ['delivered', 'failed'],
  delivered: [],
  failed: [],
};

export function allowedNextStatuses(from: OrderStatus): readonly OrderStatus[] {
  return ALLOWED_TRANSITIONS[from];
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export const STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  in_transit: 'In transit',
  delivered: 'Delivered',
  failed: 'Failed',
};
