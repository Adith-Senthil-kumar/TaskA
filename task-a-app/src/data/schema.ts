export const SCHEMA_VERSION = 1;

/**
 * One migration array, applied in order, with the applied version recorded in
 * SQLite's own user_version. Adding a migration means appending to this array
 * and never editing an earlier entry - an app that has been on a driver's phone
 * for six months has to be upgradable from whatever version it is on.
 */
export const MIGRATIONS: readonly string[] = [
  `
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS orders (
    id                TEXT PRIMARY KEY NOT NULL,
    reference         TEXT NOT NULL,
    customer_name     TEXT NOT NULL,
    customer_phone    TEXT NOT NULL,
    address           TEXT NOT NULL,
    delivery_window   TEXT NOT NULL,
    notes             TEXT,
    items_json        TEXT NOT NULL,
    status            TEXT NOT NULL,
    version           INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL,
    needs_review      INTEGER NOT NULL DEFAULT 0,
    review_json       TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
  CREATE INDEX IF NOT EXISTS idx_orders_review ON orders(needs_review);

  CREATE TABLE IF NOT EXISTS status_changes (
    id            TEXT PRIMARY KEY NOT NULL,
    order_id      TEXT NOT NULL,
    status        TEXT NOT NULL,
    recorded_at   INTEGER NOT NULL,
    failure_json  TEXT,
    proof_json    TEXT,
    synced        INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (order_id) REFERENCES orders(id)
  );

  CREATE INDEX IF NOT EXISTS idx_changes_order ON status_changes(order_id, recorded_at);

  CREATE TABLE IF NOT EXISTS outbox (
    id                TEXT PRIMARY KEY NOT NULL,
    order_id          TEXT NOT NULL,
    operation         TEXT NOT NULL,
    payload_json      TEXT NOT NULL,
    created_at        INTEGER NOT NULL,
    attempts          INTEGER NOT NULL DEFAULT 0,
    next_attempt_at   INTEGER NOT NULL,
    last_error        TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_outbox_due ON outbox(next_attempt_at, created_at);

  CREATE TABLE IF NOT EXISTS meta (
    key    TEXT PRIMARY KEY NOT NULL,
    value  TEXT NOT NULL
  );
  `,
];
