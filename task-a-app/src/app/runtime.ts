import * as SQLite from 'expo-sqlite';
import { randomUUID } from 'expo-crypto';
import { SyncEngine } from '../core/syncEngine';
import type { IdGenerator } from '../core/ports';
import { SqliteStore, migrate } from '../data/sqliteStore';
import { HttpOrderApi } from '../data/httpOrderApi';
import { NetInfoConnectivity } from '../data/connectivity';

/**
 * Composition root. This is the only file that knows about every concrete
 * implementation at once; everything else depends on the interfaces in
 * core/ports.ts. Pointing the app at a different backend or storage engine is a
 * change here and nowhere else.
 */

export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

const uuidIds: IdGenerator = { next: () => randomUUID() };

export interface Runtime {
  store: SqliteStore;
  engine: SyncEngine;
}

let runtime: Runtime | null = null;

export async function initRuntime(): Promise<Runtime> {
  if (runtime) return runtime;

  const db = await SQLite.openDatabaseAsync('lastmile.db');
  await migrate(db);

  const store = new SqliteStore(db);
  const engine = new SyncEngine({
    store,
    api: new HttpOrderApi({ baseUrl: API_BASE_URL }),
    clock: { now: () => Date.now() },
    connectivity: new NetInfoConnectivity({ reachabilityUrl: `${API_BASE_URL}/health` }),
    ids: uuidIds,
  });
  engine.start();

  runtime = { store, engine };
  return runtime;
}

export function getRuntime(): Runtime {
  if (!runtime) throw new Error('Runtime accessed before initRuntime() resolved');
  return runtime;
}

/**
 * Puts the mock server and this device back to the seeded shift.
 *
 * A demo affordance, not a product feature, and deliberately kept here rather
 * than on the OrderApi port: the sync engine has no notion of "start over", and
 * adding one to satisfy a walkthrough would be the wrong shape.
 *
 * Both halves are required. Resetting only the server leaves this phone holding
 * the mutated orders and a watermark newer than the re-seeded data, so the next
 * pull returns nothing and the reset looks broken.
 */
export async function resetDemoData(): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/admin/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!response.ok) throw new Error(`The server refused to reset (${response.status})`);

  const { store, engine } = getRuntime();
  await store.clearShiftData();
  await engine.sync();
}
