/**
 * The mock order API, as a Cloud Function, so the deployed web demo has a real
 * server to disagree with.
 *
 * The decision rules are imported from `mock-api/domain.js` — the same module
 * the local server and the test suite use. What differs here is only where the
 * state lives. A Cloud Function is stateless and may cold-start between any two
 * requests, and this API's whole purpose is to hold a version number that the
 * client can collide with, so the state has to outlive the instance.
 *
 * It is kept as a single JSON blob in one Firestore document, mutated inside a
 * transaction. That is not how a real service would model orders; it is how you
 * model a fixture whose defining property is that a read-modify-write must be
 * atomic, because the conflict demo is exactly a race between two writers.
 */
const { onRequest } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { STATUSES, seedOrders, decideStatusPush } = require('./domain');

initializeApp();
const db = getFirestore();

// Namespaced deliberately. This function is a guest in a project that runs a
// real app, and nothing here may collide with it or trip its Firestore
// triggers, which are scoped to other collections.
const STATE_DOC = db.collection('taska_mock').doc('state');

const LATENCY_MS = Number(process.env.LATENCY_MS ?? 0);
const FAILURE_RATE = Number(process.env.FAILURE_RATE ?? 0.08);
// Replay keys are kept so a retried request returns its first outcome. Unbounded
// growth would eventually exceed the 1 MiB document ceiling, so the map is
// capped and evicted oldest-first.
const MAX_IDEMPOTENCY_KEYS = 200;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freshState(now) {
  const orders = {};
  for (const order of seedOrders(now)) orders[order.id] = order;
  return { orders, idempotency: {}, keyOrder: [], forcedOffline: false };
}

async function readState(tx) {
  const snap = tx ? await tx.get(STATE_DOC) : await STATE_DOC.get();
  if (!snap.exists) return freshState(Date.now());
  try {
    return JSON.parse(snap.data().json);
  } catch {
    return freshState(Date.now());
  }
}

function writeState(tx, state) {
  // JSON rather than native fields: the seed contains optional properties, and
  // Firestore rejects `undefined` outright rather than omitting it.
  const payload = { json: JSON.stringify(state), updatedAt: Date.now() };
  if (tx) tx.set(STATE_DOC, payload);
  else return STATE_DOC.set(payload);
}

function remember(state, key, outcome) {
  state.idempotency[key] = outcome;
  state.keyOrder = state.keyOrder || [];
  state.keyOrder.push(key);
  while (state.keyOrder.length > MAX_IDEMPOTENCY_KEYS) {
    delete state.idempotency[state.keyOrder.shift()];
  }
}

exports.taskAMockApi = onRequest(
  { region: 'us-central1', cors: true, maxInstances: 3, memory: '256MiB' },
  async (req, res) => {
    const path = req.path.replace(/\/+$/, '') || '/';

    if (path === '/health') {
      const state = await readState(null);
      return res.status(200).json({ ok: true, orders: Object.keys(state.orders).length });
    }

    // ---- admin: force the situations that are otherwise hard to reproduce ----

    if (path === '/admin/offline' && req.method === 'POST') {
      const state = await readState(null);
      state.forcedOffline = Boolean(req.body?.offline);
      await writeState(null, state);
      return res.status(200).json({ offline: state.forcedOffline });
    }

    if (path === '/admin/reset' && req.method === 'POST') {
      await writeState(null, freshState(Date.now()));
      return res.status(200).json({ reset: true });
    }

    const adminStatus = path.match(/^\/admin\/orders\/([^/]+)\/status$/);
    if (adminStatus && req.method === 'POST') {
      const result = await db.runTransaction(async (tx) => {
        const state = await readState(tx);
        const order = state.orders[adminStatus[1]];
        if (!order) return { code: 404, body: { error: 'not found' } };
        if (!STATUSES.includes(req.body?.status)) {
          return { code: 400, body: { error: 'bad status' } };
        }
        const next = {
          ...order,
          status: req.body.status,
          version: order.version + 1,
          updatedAt: Date.now(),
        };
        state.orders[next.id] = next;
        writeState(tx, state);
        return { code: 200, body: { order: next } };
      });
      return res.status(result.code).json(result.body);
    }

    if (LATENCY_MS > 0) await sleep(LATENCY_MS + Math.round(Math.random() * LATENCY_MS));

    const offlineState = await readState(null);
    if (offlineState.forcedOffline) {
      // The local server destroys the socket. A Cloud Function cannot, so the
      // nearest honest equivalent is a gateway error the client treats as
      // transient and retries.
      return res.status(502).json({ error: 'Simulated outage' });
    }

    // ---------------------------------------------------------------- reads --

    if (path === '/orders' && req.method === 'GET') {
      const since = req.query.since;
      const cutoff = since === undefined ? 0 : Number(since);
      const list = Object.values(offlineState.orders).filter((o) => o.updatedAt >= cutoff);
      return res.status(200).json({ orders: list, serverTime: Date.now() });
    }

    // --------------------------------------------------------------- writes --

    const statusPush = path.match(/^\/orders\/([^/]+)\/status$/);
    if (statusPush && req.method === 'POST') {
      const key = req.get('Idempotency-Key');
      if (!key) return res.status(400).json({ error: 'Idempotency-Key header is required' });

      if (Math.random() < FAILURE_RATE) {
        return res.status(503).json({ error: 'Upstream unavailable' });
      }

      const result = await db.runTransaction(async (tx) => {
        const state = await readState(tx);

        // Replay protection. The client retries on any uncertain outcome, so a
        // repeated key must return the first result rather than write again.
        if (state.idempotency[key]) return state.idempotency[key];

        const order = state.orders[statusPush[1]];
        if (!order) return { code: 404, body: { error: 'Unknown order' } };

        const outcome = decideStatusPush(order, req.body ?? {}, Date.now());
        if (outcome.nextOrder) state.orders[outcome.nextOrder.id] = outcome.nextOrder;
        if (outcome.cache) remember(state, key, { code: outcome.code, body: outcome.body });

        writeState(tx, state);
        return { code: outcome.code, body: outcome.body };
      });

      return res.status(result.code).json(result.body);
    }

    return res.status(404).json({ error: 'Not found' });
  },
);
