/**
 * Exponential backoff with full jitter.
 *
 * Jitter is not decoration. A depot full of drivers regains signal at the same
 * moment when a van leaves an underground car park; without jitter every device
 * retries on the same schedule and the retry storm is indistinguishable from
 * the outage that caused it.
 */
export const BASE_DELAY_MS = 1_000;
export const MAX_DELAY_MS = 5 * 60_000;
export const MAX_ATTEMPTS = 8;

export function backoffDelay(
  attempts: number,
  random: () => number = Math.random,
): number {
  const exponential = Math.min(BASE_DELAY_MS * 2 ** attempts, MAX_DELAY_MS);
  return Math.round(exponential * random());
}

export function hasExhaustedRetries(attempts: number): boolean {
  return attempts >= MAX_ATTEMPTS;
}
