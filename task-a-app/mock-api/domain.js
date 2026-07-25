/**
 * The mock API's data and decision rules, with no transport and no storage.
 *
 * Split out because the same rules now run in two places: the local Node server
 * the tests drive (`server.js`), and the Cloud Function that backs the deployed
 * demo. Those two differ entirely in how they hold state — one a Map, the other
 * a Firestore document — and not at all in what they decide. Duplicating the
 * conflict and idempotency logic across them would guarantee the deployed
 * server eventually disagreed with the tested one.
 */

const STATUSES = ['pending', 'confirmed', 'in_transit', 'delivered', 'failed'];

// `delivered` and `failed` deliberately share the top rank. Neither supersedes
// the other, so a disagreement between them is escalated rather than resolved.
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

/** A realistic morning: some stops already done, most still ahead. */
function seedOrders(now) {
  const clock = now - 3 * 60 * 60 * 1000;
  const orders = [];

  for (let i = 0; i < 18; i += 1) {
    const itemCount = 1 + (i % 3);
    const items = Array.from({ length: itemCount }, (_, k) => {
      const [sku, name] = PRODUCTS[(i + k) % PRODUCTS.length];
      return { sku, name, quantity: 1 + ((i + k) % 3) };
    });
    const status = i < 4 ? 'delivered' : i < 6 ? 'in_transit' : i < 13 ? 'confirmed' : 'pending';

    orders.push({
      id: `ord-${String(i + 1).padStart(3, '0')}`,
      reference: `#${4400 + i}`,
      customerName: NAMES[i],
      customerPhone: `+44 7700 9${String(10000 + i).slice(-5)}`,
      address: STREETS[i],
      deliveryWindow: WINDOWS[i % WINDOWS.length],
      notes: i % 4 === 0 ? 'Leave with neighbour at 16 if out' : undefined,
      items,
      status,
      version: 1,
      // Raised before the shift started; touched during it.
      createdAt: clock - (18 - i) * 15 * 60_000,
      updatedAt: clock + i * 60_000,
      needsReview: false,
    });
  }
  return orders;
}

/**
 * Decides a status push against the order the server currently holds.
 *
 * Returns the outcome rather than applying it, so the caller owns persistence.
 * `cache` marks the outcomes that must be replayed for a repeated idempotency
 * key: a decision the server committed to. A 409 is deliberately not cached —
 * it describes a disagreement at a moment in time, and once the client rebases
 * the same key should be allowed to succeed.
 */
function decideStatusPush(order, payload, now) {
  if (!STATUSES.includes(payload.status)) {
    return { code: 422, body: { error: `Unknown status "${payload.status}"` }, cache: true };
  }

  if (payload.baseVersion !== order.version) {
    return { code: 409, body: { order }, cache: false, reason: 'stale-version' };
  }

  if (RANK[payload.status] < RANK[order.status]) {
    return { code: 409, body: { order }, cache: false, reason: 'moves-backwards' };
  }

  const nextOrder = {
    ...order,
    status: payload.status,
    version: order.version + 1,
    updatedAt: now,
  };
  if (payload.failure) nextOrder.failure = payload.failure;

  return { code: 200, body: { order: nextOrder }, cache: true, nextOrder };
}

module.exports = { STATUSES, RANK, seedOrders, decideStatusPush };
