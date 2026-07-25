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
 */
const http = require('node:http');
const { randomUUID } = require('node:crypto');

const PORT = Number(process.env.PORT ?? 4000);
const LATENCY_MS = Number(process.env.LATENCY_MS ?? 150);
const FAILURE_RATE = Number(process.env.FAILURE_RATE ?? 0.15);

const STATUSES = ['pending', 'confirmed', 'in_transit', 'delivered', 'failed'];
const RANK = { pending: 0, confirmed: 1, in_transit: 2, delivered: 3, failed: 3 };

const NAMES = [
  'R. Iyer', 'S. Patel', 'A. Novak', 'M. Okafor', 'L. Fournier', 'D. Kaur',
  'J. Whitfield', 'P. Almeida', 'T. Nakamura', 'C. Bergström', 'H. Mensah',
  'E. Sokolova', 'B. Ferreira', 'N. Al-Rashid', 'K. Lindqvist', 'V. Rossi',
  'G. Dlamini', 'F. Haugen',
];
const STREETS = [
  '14 Brunswick Rd', '2 Kestrel Way', '77 Ashfield Ln', '5 Marlowe Ct',
  '31 Pinewood Ave', '12 Harbour St', '8 Corvus Cl', '44 Ridley Terr',
  '19 Falkner Row', '3 Wexley Gdns', '60 Ivybridge Rd', '27 Salter St',
  '9 Northgate Ave', '15 Dunmore Pl', '52 Cranleigh Rd', '6 Tulloch Way',
  '38 Beckett Rise', '21 Harlow Mews',
];
const WINDOWS = ['08:00-11:00', '09:00-12:00', '11:00-14:00', '13:00-16:00', '15:00-18:00'];
const PRODUCTS = [
  ['SKU-1041', 'Insulated flask'], ['SKU-2277', 'Work gloves, pair'],
  ['SKU-3310', 'Cable reel 25m'], ['SKU-4198', 'First aid kit'],
  ['SKU-5502', 'Torque wrench'], ['SKU-6614', 'Safety boots'],
];

let clock = Date.now() - 3 * 60 * 60 * 1000;
const orders = new Map();
const idempotency = new Map();
let forcedOffline = false;

function seed() {
  for (let i = 0; i < 18; i += 1) {
    const id = `ord-${String(i + 1).padStart(3, '0')}`;
    const itemCount = 1 + (i % 3);
    const items = Array.from({ length: itemCount }, (_, k) => {
      const [sku, name] = PRODUCTS[(i + k) % PRODUCTS.length];
      return { sku, name, quantity: 1 + ((i + k) % 3) };
    });
    // A realistic morning: some stops already done, most still ahead.
    const status = i < 4 ? 'delivered' : i < 6 ? 'in_transit' : i < 13 ? 'confirmed' : 'pending';
    orders.set(id, {
      id,
      reference: `#${4400 + i}`,
      customerName: NAMES[i],
      customerPhone: `+44 7700 9${String(10000 + i).slice(-5)}`,
      address: STREETS[i],
      deliveryWindow: WINDOWS[i % WINDOWS.length],
      notes: i % 4 === 0 ? 'Leave with neighbour at 16 if out' : undefined,
      items,
      status,
      version: 1,
      updatedAt: clock + i * 60_000,
      needsReview: false,
    });
  }
}
seed();

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
    if (!STATUSES.includes(payload.status)) {
      const body = { error: `Unknown status "${payload.status}"` };
      idempotency.set(key, { code: 422, body });
      return json(res, 422, body);
    }

    if (payload.baseVersion !== order.version) {
      console.log(
        `[conflict] ${order.id}: client based on v${payload.baseVersion}, server at v${order.version}`,
      );
      return json(res, 409, { order });
    }

    if (RANK[payload.status] < RANK[order.status]) {
      console.log(`[reject] ${order.id}: ${order.status} -> ${payload.status} moves backwards`);
      return json(res, 409, { order });
    }

    order.status = payload.status;
    order.version += 1;
    order.updatedAt = Date.now();
    if (payload.failure) order.failure = payload.failure;

    const body = { order };
    idempotency.set(key, { code: 200, body });
    console.log(`[applied] ${order.id} -> ${order.status} (v${order.version})`);
    return json(res, 200, body);
  }

  if (path === '/health') return json(res, 200, { ok: true, orders: orders.size });

  return json(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`Lastmile mock API on http://localhost:${PORT}`);
  console.log(`  latency ${LATENCY_MS}-${LATENCY_MS * 2}ms, failure rate ${FAILURE_RATE}`);
  console.log(`  POST /admin/offline            {"offline":true}  simulate an outage`);
  console.log(`  POST /admin/orders/:id/status  {"status":"failed"}  simulate dispatch`);
});
