import type { Order, OutboxEntry, SyncStatus } from '../core/types';

/**
 * The five sync states a row can be in, and the labels the design assigns them.
 *
 * `synced` deliberately has no badge. The absence of a badge is how the driver
 * reads "this one is done", which is what keeps a list of eighteen stops
 * scannable at a glance.
 */
export type SyncKind = 'synced' | 'local' | 'sending' | 'failed' | 'conflict';

export function syncKindFor(
  order: Order,
  queue: OutboxEntry[],
  status: SyncStatus | null,
): SyncKind {
  if (order.needsReview) return 'conflict';
  const mine = queue.filter((entry) => entry.orderId === order.id);
  if (mine.length === 0) return 'synced';
  if (status?.phase === 'syncing' && status.connection === 'online') return 'sending';
  if (mine.some((entry) => entry.attempts > 0)) return 'failed';
  return 'local';
}

export function entriesFor(orderId: string, queue: OutboxEntry[]): OutboxEntry[] {
  return queue.filter((entry) => entry.orderId === orderId);
}

export interface BadgeSpec {
  label: string;
  tone: 'or' | 'red' | 'pur';
  pulse: boolean;
}

/** Row badge. Returns null for synced, which is the point. */
export function rowBadge(kind: SyncKind, entries: OutboxEntry[]): BadgeSpec | null {
  switch (kind) {
    case 'conflict':
      return { label: 'Decide', tone: 'pur', pulse: false };
    case 'sending':
      return { label: 'Sending', tone: 'or', pulse: true };
    case 'failed':
      return {
        label: `Retry ${Math.max(...entries.map((e) => e.attempts), 1)}`,
        tone: 'red',
        pulse: false,
      };
    case 'local':
      return { label: `${entries.length} to send`, tone: 'or', pulse: false };
    case 'synced':
      return null;
  }
}

/** Detail-screen pill. Spells the state out, since there is room to. */
export function detailPill(kind: SyncKind): { label: string; tone: BadgeSpec['tone'] | 'neutral'; pulse: boolean } {
  switch (kind) {
    case 'conflict':
      return { label: 'Needs a decision', tone: 'pur', pulse: false };
    case 'sending':
      return { label: 'Sending…', tone: 'or', pulse: true };
    case 'failed':
      return { label: 'Server refused — retrying', tone: 'red', pulse: false };
    case 'local':
      return { label: 'On this phone', tone: 'or', pulse: false };
    case 'synced':
      return { label: 'On the server', tone: 'neutral', pulse: false };
  }
}
