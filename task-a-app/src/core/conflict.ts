import { isTerminal, rankOf } from './statusMachine';
import type { Order, OrderStatus, ReviewSnapshot } from './types';

export type ConflictOutcome =
  /** Local change supersedes the server. Re-push it against the new version. */
  | { resolution: 'keep_local'; reason: string }
  /** Server supersedes the local change. Drop the queued write, adopt server. */
  | { resolution: 'take_server'; reason: string }
  /** Genuinely ambiguous. Surface both to the driver. */
  | { resolution: 'needs_review'; reason: string };

export interface ConflictInput {
  localStatus: OrderStatus;
  serverStatus: OrderStatus;
}

/**
 * The rule: an order's status never moves backwards.
 *
 * Chosen over last-write-wins deliberately. Last-write-wins depends on client
 * clocks, and a driver's phone can be minutes out - or hours out, after a
 * timezone change or a manual clock edit. Worse, it fails in exactly the case
 * that matters: a driver marks a parcel delivered offline, dispatch marks it
 * in transit a minute later, and on reconnect the newer write silently erases
 * the delivery. Ranking statuses instead means the outcome depends on what
 * physically happened to the parcel, not on whose clock was ahead.
 *
 * The one case the rank cannot settle is `delivered` versus `failed`. Both are
 * terminal, neither is "further along", and the difference is a real-world fact
 * the app cannot infer. That is the only path to needs_review, and it is a
 * deliberate design choice: a wrong automatic answer there means either a
 * customer charged for a parcel they never got, or a parcel written off that
 * was actually handed over.
 */
export function resolveStatusConflict(input: ConflictInput): ConflictOutcome {
  const { localStatus, serverStatus } = input;

  if (localStatus === serverStatus) {
    return {
      resolution: 'take_server',
      reason: 'Server already holds this status; the queued change is redundant.',
    };
  }

  const localRank = rankOf(localStatus);
  const serverRank = rankOf(serverStatus);

  if (localRank === serverRank && isTerminal(localStatus) && isTerminal(serverStatus)) {
    return {
      resolution: 'needs_review',
      reason:
        'Both outcomes are final and neither supersedes the other. A person must confirm what happened at the door.',
    };
  }

  if (localRank > serverRank) {
    return {
      resolution: 'keep_local',
      reason: `Local status "${localStatus}" is further along than server status "${serverStatus}".`,
    };
  }

  return {
    resolution: 'take_server',
    reason: `Server status "${serverStatus}" is further along than local status "${localStatus}".`,
  };
}

export function buildReviewSnapshot(
  serverOrder: Order,
  localStatus: OrderStatus,
  localRecordedAt: number,
): ReviewSnapshot {
  return {
    serverStatus: serverOrder.status,
    serverVersion: serverOrder.version,
    serverUpdatedAt: serverOrder.updatedAt,
    localStatus,
    localRecordedAt,
  };
}

/**
 * Merge for the pull path. A pulled order must not clobber a local status that
 * is further along and still sitting in the outbox.
 */
export function mergePulledOrder(local: Order | null, remote: Order): Order {
  if (!local) return remote;

  if (local.needsReview) {
    // Never let a background pull quietly overwrite something awaiting a human.
    return { ...remote, needsReview: true, reviewSnapshot: local.reviewSnapshot };
  }

  const outcome = resolveStatusConflict({
    localStatus: local.status,
    serverStatus: remote.status,
  });

  if (outcome.resolution === 'keep_local') {
    // Take the server's record but hold the local status until the queued
    // change has been accepted.
    return { ...remote, status: local.status };
  }

  if (outcome.resolution === 'needs_review') {
    return {
      ...remote,
      needsReview: true,
      reviewSnapshot: buildReviewSnapshot(remote, local.status, local.updatedAt),
    };
  }

  return remote;
}
