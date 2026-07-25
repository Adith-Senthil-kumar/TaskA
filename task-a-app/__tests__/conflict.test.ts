import { mergePulledOrder, resolveStatusConflict } from '../src/core/conflict';
import { makeOrder } from './fakes';

describe('resolveStatusConflict - status never moves backwards', () => {
  it('keeps the local status when it is further along', () => {
    const outcome = resolveStatusConflict({
      localStatus: 'delivered',
      serverStatus: 'in_transit',
    });
    expect(outcome.resolution).toBe('keep_local');
  });

  it('takes the server status when the server is further along', () => {
    const outcome = resolveStatusConflict({
      localStatus: 'confirmed',
      serverStatus: 'in_transit',
    });
    expect(outcome.resolution).toBe('take_server');
  });

  it('treats an identical status as redundant rather than conflicting', () => {
    const outcome = resolveStatusConflict({
      localStatus: 'delivered',
      serverStatus: 'delivered',
    });
    expect(outcome.resolution).toBe('take_server');
  });

  it('escalates delivered versus failed, the one case rank cannot settle', () => {
    expect(
      resolveStatusConflict({ localStatus: 'delivered', serverStatus: 'failed' }).resolution,
    ).toBe('needs_review');
    expect(
      resolveStatusConflict({ localStatus: 'failed', serverStatus: 'delivered' }).resolution,
    ).toBe('needs_review');
  });

  it('is symmetric: swapping the inputs never produces two winners', () => {
    const statuses = ['pending', 'confirmed', 'in_transit', 'delivered', 'failed'] as const;
    for (const a of statuses) {
      for (const b of statuses) {
        const forward = resolveStatusConflict({ localStatus: a, serverStatus: b });
        const reverse = resolveStatusConflict({ localStatus: b, serverStatus: a });
        if (forward.resolution === 'keep_local') {
          expect(reverse.resolution).toBe('take_server');
        }
        if (forward.resolution === 'needs_review') {
          expect(reverse.resolution).toBe('needs_review');
        }
      }
    }
  });

  it('never resolves in favour of a clock, only of a rank', () => {
    // Local device clock is hours ahead, but its status is behind. A
    // last-write-wins implementation would wrongly pick local here.
    const outcome = resolveStatusConflict({
      localStatus: 'confirmed',
      serverStatus: 'delivered',
    });
    expect(outcome.resolution).toBe('take_server');
  });
});

describe('mergePulledOrder', () => {
  it('adopts the remote order when there is no local copy', () => {
    const remote = makeOrder({ status: 'confirmed' });
    expect(mergePulledOrder(null, remote)).toEqual(remote);
  });

  it('does not let a pull overwrite a local status that is further along', () => {
    const local = makeOrder({ status: 'delivered', version: 3 });
    const remote = makeOrder({ status: 'in_transit', version: 4 });
    const merged = mergePulledOrder(local, remote);
    expect(merged.status).toBe('delivered');
    expect(merged.version).toBe(4);
  });

  it('accepts the remote status when the server has moved further along', () => {
    const local = makeOrder({ status: 'confirmed' });
    const remote = makeOrder({ status: 'delivered', version: 9 });
    expect(mergePulledOrder(local, remote).status).toBe('delivered');
  });

  it('flags a pull that lands on the ambiguous terminal pair', () => {
    const local = makeOrder({ status: 'delivered' });
    const remote = makeOrder({ status: 'failed', version: 5 });
    const merged = mergePulledOrder(local, remote);
    expect(merged.needsReview).toBe(true);
    expect(merged.reviewSnapshot?.localStatus).toBe('delivered');
    expect(merged.reviewSnapshot?.serverStatus).toBe('failed');
  });

  it('never clears a review flag that a human has not answered yet', () => {
    const local = makeOrder({ status: 'delivered', needsReview: true });
    const remote = makeOrder({ status: 'delivered', version: 7 });
    expect(mergePulledOrder(local, remote).needsReview).toBe(true);
  });
});
