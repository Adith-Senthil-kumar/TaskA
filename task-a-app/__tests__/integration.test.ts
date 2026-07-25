import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { HttpOrderApi } from '../src/data/httpOrderApi';
import { SyncEngine } from '../src/core/syncEngine';
import { FakeClock, FakeConnectivity, InMemoryStore, UuidIds } from './fakes';
import type { Order } from '../src/core/types';

/**
 * End-to-end against the real mock API process.
 *
 * The unit tests prove the engine's logic against fakes. This proves the wiring:
 * that the HTTP client classifies real responses correctly, that a 409 from a
 * real server reaches the conflict path, and that a replayed idempotency key
 * does not produce a second write.
 */

const PORT = 4577;
const BASE_URL = `http://127.0.0.1:${PORT}`;
let server: ChildProcess;

async function waitForServer(attempts = 40): Promise<void> {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(`${BASE_URL}/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Mock API did not start');
}

beforeAll(async () => {
  server = spawn(
    process.execPath,
    [path.join(__dirname, '..', 'mock-api', 'server.js')],
    {
      // Deterministic: no injected chaos, minimal latency. The failure paths are
      // covered by the unit tests; this file is about the happy wiring.
      env: { ...process.env, PORT: String(PORT), LATENCY_MS: '0', FAILURE_RATE: '0' },
      stdio: 'ignore',
    },
  );
  await waitForServer();
}, 20_000);

afterAll(() => {
  server?.kill();
});

function buildEngine(orders: Order[] = []) {
  const store = new InMemoryStore(orders);
  const api = new HttpOrderApi({ baseUrl: BASE_URL });
  const engine = new SyncEngine({
    store,
    api,
    clock: new FakeClock(),
    connectivity: new FakeConnectivity('online'),
    ids: new UuidIds(),
    autoFlush: false,
  });
  return { store, api, engine };
}

describe('against the real mock API', () => {
  it('pulls the day\'s orders into the local database', async () => {
    const { store, engine } = buildEngine();
    await engine.pull();

    const orders = await store.getOrders();
    expect(orders.length).toBeGreaterThan(10);
    expect(orders[0]!.reference).toMatch(/^#\d+$/);
  });

  it('sends a status change and adopts the server\'s new version', async () => {
    const { store, engine } = buildEngine();
    await engine.pull();

    const target = (await store.getOrders()).find((o) => o.status === 'confirmed')!;
    const before = target.version;

    await engine.recordStatusChange({ orderId: target.id, status: 'in_transit' });
    const report = await engine.flush();

    expect(report.applied).toBe(1);
    expect(store.outbox).toHaveLength(0);
    const after = (await store.getOrder(target.id))!;
    expect(after.status).toBe('in_transit');
    expect(after.version).toBe(before + 1);
  });

  it('treats a replayed idempotency key as one write, not two', async () => {
    const { store, engine } = buildEngine();
    await engine.pull();
    const target = (await store.getOrders()).find((o) => o.status === 'confirmed')!;

    await engine.recordStatusChange({ orderId: target.id, status: 'in_transit' });
    const entry = store.outbox[0]!;

    const api = new HttpOrderApi({ baseUrl: BASE_URL });
    const first = await api.pushStatusChange(target.id, entry.payload, entry.id);
    const second = await api.pushStatusChange(target.id, entry.payload, entry.id);

    expect(first.kind).toBe('applied');
    expect(second.kind).toBe('applied');
    if (first.kind === 'applied' && second.kind === 'applied') {
      // The version must not have advanced twice for one logical change.
      expect(second.order.version).toBe(first.order.version);
    }
  });

  it('resolves in the driver\'s favour when dispatch is behind', async () => {
    const { store, engine } = buildEngine();
    await engine.pull();
    const target = (await store.getOrders()).find((o) => o.status === 'in_transit')!;

    // Dispatch moves the order underneath us, so the client's baseVersion is stale.
    await fetch(`${BASE_URL}/admin/orders/${target.id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'in_transit' }),
    });

    await engine.recordStatusChange({ orderId: target.id, status: 'delivered' });
    await engine.flush();

    // First pass hits 409, rebases onto the server version, stays queued.
    expect(store.outbox).toHaveLength(1);
    const rebased = store.outbox[0]!.payload.baseVersion;
    expect(rebased).toBeGreaterThan(target.version);

    const second = await engine.flush();
    expect(second.applied).toBe(1);
    expect((await store.getOrder(target.id))!.status).toBe('delivered');
  });

  it('escalates when dispatch has already marked the order failed', async () => {
    const { store, engine } = buildEngine();
    await engine.pull();
    const target = (await store.getOrders()).find((o) => o.status === 'confirmed')!;

    await engine.recordStatusChange({ orderId: target.id, status: 'in_transit' });
    await engine.flush();

    await fetch(`${BASE_URL}/admin/orders/${target.id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'failed' }),
    });

    await engine.recordStatusChange({ orderId: target.id, status: 'delivered' });
    await engine.flush();

    const order = (await store.getOrder(target.id))!;
    expect(order.needsReview).toBe(true);
    expect(order.reviewSnapshot?.serverStatus).toBe('failed');
    expect(order.reviewSnapshot?.localStatus).toBe('delivered');
    expect(store.outbox).toHaveLength(0);
  });
});
