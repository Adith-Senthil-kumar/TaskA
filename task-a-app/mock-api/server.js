#!/usr/bin/env node
/**
 * Mock order API for Lastmile.
 *
 * Written with the Node standard library only so `npm run mock-api` works
 * without a second install step.
 *
 * It is deliberately hostile. A mock that always returns 200 in 5ms proves
 * nothing about an offline-first client: every interesting branch in the sync
 * engine - retry, backoff, conflict, idempotent replay - is unreachable unless
 * the server can be slow, flaky and disagreeable on demand.
 *
 *   PORT=4000 LATENCY_MS=250 FAILURE_RATE=0.2 npm run mock-api
 *
 * Admin endpoints let you force the situations that are otherwise hard to
 * reproduce by hand:
 *   POST /admin/orders/:id/status  { "status": "failed" }   simulate dispatch
 *   POST /admin/offline           { "offline": true }       simulate an outage
 *   POST /admin/reset                                       back to the seed
 */
const http = require('node:http');
const { STATUSES, seedOrders, decideStatusPush } = require('./domain');

const PORT = Number(process.env.PORT ?? 4000);
const LATENCY_MS = Number(process.env.LATENCY_MS ?? 150);
const FAILURE_RATE = Number(process.env.FAILURE_RATE ?? 0.15);

const orders = new Map();
const idempotency = new Map();
let forcedOffline = false;

for (const order of seedOrders(Date.now())) orders.set(order.id, order);

const json = (res, code, body) => {
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Idempotency-Key',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  res.end(JSON.stringify(body));
};

const readBody = (req) =>
  new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {});

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  if (path === '/admin/reset' && req.method === 'POST') {
    orders.clear();
    idempotency.clear();
    forcedOffline = false;
    for (const order of seedOrders(Date.now())) orders.set(order.id, order);
    console.log('[admin] reset to the seeded shift');
    return json(res, 200, { reset: true, orders: orders.size });
  }

  if (path === '/admin/offline' && req.method === 'POST') {
    const body = await readBody(req);
    forcedOffline = Boolean(body.offline);
    return json(res, 200, { offline: forcedOffline });
  }

  const adminStatus = path.match(/^\/admin\/orders\/([^/]+)\/status$/);
  if (adminStatus && req.method === 'POST') {
    const order = orders.get(adminStatus[1]);
    if (!order) return json(res, 404, { error: 'not found' });
    const body = await readBody(req);
    if (!STATUSES.includes(body.status)) return json(res, 400, { error: 'bad status' });
    order.status = body.status;
    order.version += 1;
    order.updatedAt = Date.now();
    console.log(`[admin] ${order.id} forced to ${body.status} (v${order.version})`);
    return json(res, 200, { order });
  }

  await sleep(LATENCY_MS + Math.round(Math.random() * LATENCY_MS));

  if (forcedOffline) {
    res.destroy();
    return;
  }

  if (path === '/orders' && req.method === 'GET') {
    const since = url.searchParams.get('since');
    const cutoff = since === null ? 0 : Number(since);
    const list = [...orders.values()].filter((o) => o.updatedAt >= cutoff);
    return json(res, 200, { orders: list, serverTime: Date.now() });
  }

  const statusPush = path.match(/^\/orders\/([^/]+)\/status$/);
  if (statusPush && req.method === 'POST') {
    const key = req.headers['idempotency-key'];
    if (!key) return json(res, 400, { error: 'Idempotency-Key header is required' });

    // Replay protection. The client retries on any uncertain outcome, so the
    // second arrival of a key must return the first result, not write again.
    if (idempotency.has(key)) {
      const cached = idempotency.get(key);
      console.log(`[replay] ${key} -> ${cached.code}`);
      return json(res, cached.code, cached.body);
    }

    if (Math.random() < FAILURE_RATE) {
      console.log(`[chaos] 503 for ${statusPush[1]}`);
      return json(res, 503, { error: 'Upstream unavailable' });
    }

    const order = orders.get(statusPush[1]);
    if (!order) return json(res, 404, { error: 'Unknown order' });

    const payload = await readBody(req);
    const outcome = decideStatusPush(order, payload, Date.now());

    if (outcome.cache) idempotency.set(key, { code: outcome.code, body: outcome.body });
    if (outcome.nextOrder) orders.set(order.id, outcome.nextOrder);

    if (outcome.reason === 'stale-version') {
      console.log(
        `[conflict] ${order.id}: client based on v${payload.baseVersion}, server at v${order.version}`,
      );
    } else if (outcome.reason === 'moves-backwards') {
      console.log(`[reject] ${order.id}: ${order.status} -> ${payload.status} moves backwards`);
    } else if (outcome.code === 200) {
      console.log(`[applied] ${order.id} -> ${outcome.nextOrder.status} (v${outcome.nextOrder.version})`);
    }

    return json(res, outcome.code, outcome.body);
  }

  if (path === '/health') return json(res, 200, { ok: true, orders: orders.size });

  return json(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`Lastmile mock API on http://localhost:${PORT}`);
  console.log(`  latency ${LATENCY_MS}-${LATENCY_MS * 2}ms, failure rate ${FAILURE_RATE}`);
  console.log(`  POST /admin/offline            {"offline":true}  simulate an outage`);
  console.log(`  POST /admin/reset                                back to the seeded shift`);
  console.log(`  POST /admin/orders/:id/status  {"status":"failed"}  simulate dispatch`);
});
