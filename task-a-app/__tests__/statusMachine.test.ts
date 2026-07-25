import {
  allowedNextStatuses,
  canTransition,
  isTerminal,
  rankOf,
} from '../src/core/statusMachine';

describe('status machine', () => {
  it('ranks the delivery journey in order', () => {
    expect(rankOf('pending')).toBeLessThan(rankOf('confirmed'));
    expect(rankOf('confirmed')).toBeLessThan(rankOf('in_transit'));
    expect(rankOf('in_transit')).toBeLessThan(rankOf('delivered'));
  });

  it('gives the two terminal outcomes equal rank', () => {
    expect(rankOf('delivered')).toBe(rankOf('failed'));
    expect(isTerminal('delivered')).toBe(true);
    expect(isTerminal('failed')).toBe(true);
  });

  it('offers no onward transitions from a terminal status', () => {
    expect(allowedNextStatuses('delivered')).toHaveLength(0);
    expect(allowedNextStatuses('failed')).toHaveLength(0);
  });

  it('refuses to move an order backwards', () => {
    expect(canTransition('delivered', 'in_transit')).toBe(false);
    expect(canTransition('in_transit', 'pending')).toBe(false);
  });

  it('allows failure from any non-terminal status', () => {
    expect(canTransition('pending', 'failed')).toBe(true);
    expect(canTransition('confirmed', 'failed')).toBe(true);
    expect(canTransition('in_transit', 'failed')).toBe(true);
  });

  it('does not allow skipping straight from pending to delivered', () => {
    expect(canTransition('pending', 'delivered')).toBe(false);
  });
});
