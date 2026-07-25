import { SyncEngine, TransitionNotAllowedError } from '../src/core/syncEngine';
import { FakeApi, FakeClock, FakeConnectivity, InMemoryStore, SeqIds, makeOrder } from './fakes';

function build(
  options: {
    online?: boolean;
    orders?: ReturnType<typeof makeOrder>[];
    autoFlush?: boolean;
  } = {},
) {
  const store = new InMemoryStore(options.orders ?? [makeOrder()]);
  const api = new FakeApi();
  const clock = new FakeClock();
  const connectivity = new FakeConnectivity(options.online === false ? 'offline' : 'online');
  const engine = new SyncEngine({
    store,
    api,
    clock,
    connectivity,
    ids: new SeqIds(),
    random: () => 1,
    autoFlush: options.autoFlush ?? false,
  });
  return { store, api, clock, connectivity, engine };
}

describe('recording a status change', () => {
  it('commits locally and returns before the network is consulted', async () => {
    const { store, api, engine } = build({ online: false });

    const updated = await engine.recordStatusChange({ orderId: 'o1', status: 'delivered' });

    expect(updated.status).toBe('delivered');
    expect((await store.getOrder('o1'))!.status).toBe('delivered');
    expect(store.outbox).toHaveLength(1);
    expect(api.calls).toHaveLength(0);
  });

  it('writes the order, the history entry and the outbox entry together', async () => {
    const { store, engine } = build({ online: false });
    store.failNextCommit = true;

    await expect(
      engine.recordStatusChange({ orderId: 'o1', status: 'delivered' }),
    ).rejects.toThrow('disk full');

    // Nothing partial survives: no queued write, no rewritten order.
    expect(store.outbox).toHaveLength(0);
    expect(store.history).toHaveLength(0);
    expect((await store.getOrder('o1'))!.status).toBe('in_transit');
  });

  it('refuses a transition the delivery process does not allow', async () => {
    const { engine } = build({ orders: [makeOrder({ status: 'delivered' })] });
    await expect(
      engine.recordStatusChange({ orderId: 'o1', status: 'in_transit' }),
    ).rejects.toBeInstanceOf(TransitionNotAllowedError);
  });

  it('captures the failure reason when a delivery could not be completed', async () => {
    const { store, engine } = build({ online: false });
    await engine.recordStatusChange({
      orderId: 'o1',
      status: 'failed',
      failure: { reason: 'nobody_home', notes: 'No safe place' },
    });
    expect(store.outbox[0].payload.failure).toEqual({
      reason: 'nobody_home',
      notes: 'No safe place',
    });
  });
});

describe('flushing the outbox', () => {
  it('does not attempt anything while offline', async () => {
    const { api, engine } = build({ online: false });
    await engine.recordStatusChange({ orderId: 'o1', status: 'delivered' });

    const report = await engine.flush();

    expect(report.skippedOffline).toBe(true);
    expect(api.calls).toHaveLength(0);
  });

  it('sends queued work and clears it once the server accepts', async () => {
    const { store, api, connectivity, engine } = build({ online: false });
    await engine.recordStatusChange({ orderId: 'o1', status: 'delivered' });

    api.program({ kind: 'applied', order: makeOrder({ status: 'delivered', version: 4 }) });
    connectivity.set('online');
    const report = await engine.flush();

    expect(report.applied).toBe(1);
    expect(store.outbox).toHaveLength(0);
    expect(store.history[0].synced).toBe(true);
    expect((await store.getOrder('o1'))!.version).toBe(4);
  });

  it('drains everything queued during an outage when signal returns', async () => {
    const orders = [makeOrder({ id: 'o1' }), makeOrder({ id: 'o2' }), makeOrder({ id: 'o3' })];
    const { store, connectivity, api, engine } = build({ online: false, orders });

    await engine.recordStatusChange({ orderId: 'o1', status: 'delivered' });
    await engine.recordStatusChange({ orderId: 'o2', status: 'delivered' });
    await engine.recordStatusChange({ orderId: 'o3', status: 'failed', failure: { reason: 'refused' } });
    expect(store.outbox).toHaveLength(3);

    api.always({ kind: 'applied', order: makeOrder({ status: 'delivered', version: 9 }) });
    connectivity.set('online');
    const report = await engine.flush();

    expect(report.applied).toBe(3);
    expect(store.outbox).toHaveLength(0);
  });
});

describe('retry behaviour', () => {
  it('keeps the entry and schedules a later attempt on a transient failure', async () => {
    const { store, clock, api, engine } = build();
    await engine.recordStatusChange({ orderId: 'o1', status: 'delivered' });
    store.outbox[0].nextAttemptAt = clock.now();

    api.always({ kind: 'transient', message: 'network unreachable' });
    const report = await engine.flush();

    expect(report.deferred).toBe(1);
    expect(store.outbox).toHaveLength(1);
    expect(store.outbox[0].attempts).toBe(1);
    expect(store.outbox[0].nextAttemptAt).toBeGreaterThan(clock.now());
    expect(store.outbox[0].lastError).toBe('network unreachable');
  });

  it('does not retry an entry before its backoff window has elapsed', async () => {
    const { store, api, engine } = build();
    await engine.recordStatusChange({ orderId: 'o1', status: 'delivered' });

    api.always({ kind: 'transient', message: 'timeout' });
    await engine.flush();
    const callsAfterFirst = api.calls.length;

    await engine.flush();
    expect(api.calls).toHaveLength(callsAfterFirst);
  });

  it('reuses the same idempotency key on every retry of the same change', async () => {
    const { store, clock, api, engine } = build();
    await engine.recordStatusChange({ orderId: 'o1', status: 'delivered' });

    api.always({ kind: 'transient', message: 'timeout' });
    await engine.flush();
    clock.advance(10 * 60_000);
    await engine.flush();

    expect(api.calls).toHaveLength(2);
    expect(api.calls[0].key).toBe(api.calls[1].key);
  });

  it('stops retrying and escalates to the driver rather than looping forever', async () => {
    const { store, clock, api, engine } = build();
    await engine.recordStatusChange({ orderId: 'o1', status: 'delivered' });

    api.always({ kind: 'transient', message: 'gateway down' });
    for (let i = 0; i < 9; i += 1) {
      clock.advance(10 * 60_000);
      await engine.flush();
    }

    expect(store.outbox).toHaveLength(0);
    expect((await store.getOrder('o1'))!.needsReview).toBe(true);
  });

  it('removes an entry the server will never accept, but flags it for a human', async () => {
    const { store, api, engine } = build();
    await engine.recordStatusChange({ orderId: 'o1', status: 'delivered' });

    api.always({ kind: 'permanent', message: 'order cancelled by dispatch' });
    const report = await engine.flush();

    expect(report.failed).toBe(1);
    expect(store.outbox).toHaveLength(0);
    const order = (await store.getOrder('o1'))!;
    expect(order.needsReview).toBe(true);
    expect(order.reviewSnapshot?.localStatus).toBe('delivered');
  });
});

describe('ordering', () => {
  it('holds back later changes to an order whose earlier change has not landed', async () => {
    const { store, api, clock, engine } = build({ orders: [makeOrder({ status: 'confirmed' })] });

    api.always({ kind: 'transient', message: 'timeout' });
    await engine.recordStatusChange({ orderId: 'o1', status: 'in_transit' });
    clock.advance(1);
    await engine.recordStatusChange({ orderId: 'o1', status: 'delivered' });
    store.outbox.forEach((e) => (e.nextAttemptAt = clock.now()));
    api.calls.length = 0;

    await engine.flush();

    // Only the older change was attempted; the delivery must not overtake it.
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].payload.status).toBe('in_transit');
  });

  it('does not let one stalled order block a different order', async () => {
    const orders = [makeOrder({ id: 'o1' }), makeOrder({ id: 'o2' })];
    const { store, api, clock, connectivity, engine } = build({ online: false, orders });

    await engine.recordStatusChange({ orderId: 'o1', status: 'delivered' });
    clock.advance(1);
    await engine.recordStatusChange({ orderId: 'o2', status: 'delivered' });
    connectivity.set('online');

    api.program(
      { kind: 'transient', message: 'timeout' },
      { kind: 'applied', order: makeOrder({ id: 'o2', status: 'delivered', version: 4 }) },
    );
    await engine.flush();

    expect(api.calls.map((c) => c.orderId)).toEqual(['o1', 'o2']);
    expect(store.outbox.map((e) => e.orderId)).toEqual(['o1']);
  });

  it('ignores a second flush that races the first', async () => {
    const { api, engine } = build();
    await engine.recordStatusChange({ orderId: 'o1', status: 'delivered' });
    api.always({ kind: 'applied', order: makeOrder({ status: 'delivered', version: 4 }) });
    api.calls.length = 0;

    await Promise.all([engine.flush(), engine.flush()]);

    expect(api.calls).toHaveLength(1);
  });
});

describe('conflict handling during sync', () => {
  it('adopts the server state when the server is further along', async () => {
    const { store, api, engine } = build({ orders: [makeOrder({ status: 'confirmed' })] });
    await engine.recordStatusChange({ orderId: 'o1', status: 'in_transit' });

    api.always({
      kind: 'conflict',
      serverOrder: makeOrder({ status: 'delivered', version: 8 }),
    });
    const report = await engine.flush();

    expect(report.conflicted).toBe(1);
    expect(store.outbox).toHaveLength(0);
    expect((await store.getOrder('o1'))!.status).toBe('delivered');
  });

  it('rebases and retries when the local change is further along', async () => {
    const { store, clock, api, engine } = build();
    await engine.recordStatusChange({ orderId: 'o1', status: 'delivered' });

    api.program({
      kind: 'conflict',
      serverOrder: makeOrder({ status: 'in_transit', version: 11 }),
    });
    await engine.flush();

    expect(store.outbox).toHaveLength(1);
    expect(store.outbox[0].payload.baseVersion).toBe(11);

    api.program({ kind: 'applied', order: makeOrder({ status: 'delivered', version: 12 }) });
    clock.advance(10 * 60_000);
    await engine.flush();

    expect(store.outbox).toHaveLength(0);
    expect((await store.getOrder('o1'))!.status).toBe('delivered');
  });

  it('escalates delivered versus failed instead of guessing', async () => {
    const { store, api, engine } = build();
    await engine.recordStatusChange({ orderId: 'o1', status: 'delivered' });

    api.always({ kind: 'conflict', serverOrder: makeOrder({ status: 'failed', version: 6 }) });
    await engine.flush();

    const order = (await store.getOrder('o1'))!;
    expect(order.needsReview).toBe(true);
    expect(order.reviewSnapshot).toEqual(
      expect.objectContaining({ serverStatus: 'failed', localStatus: 'delivered' }),
    );
    expect(store.outbox).toHaveLength(0);
  });

  it("queues the human's answer as an ordinary change", async () => {
    const { store, api, engine } = build();
    await engine.recordStatusChange({ orderId: 'o1', status: 'delivered' });
    api.always({ kind: 'conflict', serverOrder: makeOrder({ status: 'failed', version: 6 }) });
    await engine.flush();

    api.calls.length = 0;
    api.program({ kind: 'applied', order: makeOrder({ status: 'delivered', version: 7 }) });
    await engine.resolveReview('o1', 'delivered');

    const order = (await store.getOrder('o1'))!;
    expect(order.needsReview).toBe(false);
    expect(order.status).toBe('delivered');
  });
});

describe('reacting to connectivity', () => {
  it('sends a change immediately when the driver already has signal', async () => {
    const { store, api, engine } = build({ autoFlush: true });
    api.always({ kind: 'applied', order: makeOrder({ status: 'delivered', version: 4 }) });

    await engine.recordStatusChange({ orderId: 'o1', status: 'delivered' });
    await new Promise((resolve) => setImmediate(resolve));

    expect(api.calls).toHaveLength(1);
    expect(store.outbox).toHaveLength(0);
  });

  it('syncs automatically when signal returns, without polling while offline', async () => {
    const { store, api, connectivity, engine } = build({ online: false });
    engine.start();

    await engine.recordStatusChange({ orderId: 'o1', status: 'delivered' });
    expect(api.calls).toHaveLength(0);

    api.always({ kind: 'applied', order: makeOrder({ status: 'delivered', version: 4 }) });
    connectivity.set('online');
    await new Promise((resolve) => setImmediate(resolve));

    expect(api.calls.length).toBeGreaterThan(0);
    expect(store.outbox).toHaveLength(0);
    engine.stop();
  });

  it('reports pending work and unresolved reviews to the UI', async () => {
    const { engine } = build({ online: false });
    const seen: number[] = [];
    engine.subscribe((status) => seen.push(status.pendingCount));

    await engine.recordStatusChange({ orderId: 'o1', status: 'delivered' });

    expect(engine.getStatus().pendingCount).toBe(1);
    expect(engine.getStatus().connection).toBe('offline');
    expect(seen[0]).toBe(0);
  });
});

describe('pulling from the server', () => {
  it('asks for everything on first run and uses a watermark afterwards', async () => {
    const { store, api, engine } = build();
    api.remoteOrders = [makeOrder({ updatedAt: 1_700_000_500_000 })];

    await engine.pull();
    expect(api.fetched[0]).toBeNull();

    await engine.pull();
    expect(api.fetched[1]).toBe(1_700_000_500_000);
    expect(store.watermark).toBe(1_700_000_500_000);
  });

  it('does not overwrite a local delivery that has not been sent yet', async () => {
    const { store, api, engine } = build({ online: false });
    await engine.recordStatusChange({ orderId: 'o1', status: 'delivered' });

    api.remoteOrders = [makeOrder({ status: 'in_transit', version: 5 })];
    await engine.pull();

    expect((await store.getOrder('o1'))!.status).toBe('delivered');
  });
});
