import { BASE_DELAY_MS, MAX_DELAY_MS, backoffDelay, hasExhaustedRetries } from '../src/core/backoff';

describe('backoff', () => {
  it('grows exponentially with the attempt count', () => {
    const noJitter = () => 1;
    expect(backoffDelay(0, noJitter)).toBe(BASE_DELAY_MS);
    expect(backoffDelay(1, noJitter)).toBe(BASE_DELAY_MS * 2);
    expect(backoffDelay(3, noJitter)).toBe(BASE_DELAY_MS * 8);
  });

  it('caps the delay so a recovered device is not stuck waiting for hours', () => {
    expect(backoffDelay(50, () => 1)).toBe(MAX_DELAY_MS);
  });

  it('applies jitter so a depot of vans does not retry in lockstep', () => {
    expect(backoffDelay(4, () => 0)).toBe(0);
    expect(backoffDelay(4, () => 0.5)).toBeLessThan(backoffDelay(4, () => 1));
  });

  it('stops retrying eventually rather than looping forever', () => {
    expect(hasExhaustedRetries(7)).toBe(false);
    expect(hasExhaustedRetries(8)).toBe(true);
  });
});
