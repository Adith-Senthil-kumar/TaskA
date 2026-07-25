import { create } from 'zustand';
import type { Order, OrderStatus, OutboxEntry, SyncStatus } from '../core/types';
import type { StatusChangeInput } from '../core/syncEngine';
import { getRuntime, initRuntime } from '../app/runtime';

/**
 * Zustand holds a projection of the database, not a second source of truth.
 *
 * Every mutation goes to the sync engine, which writes SQLite; the store is
 * then refilled by reading SQLite back. It is one extra read, and it buys the
 * guarantee that what the driver sees is what is actually persisted - so a
 * force-quit mid-shift loses nothing and shows nothing that was never saved.
 *
 * Redux Toolkit would work here too. It was not chosen because its main
 * benefits - enforced action shapes, middleware, devtools - address a
 * coordination problem this app does not have: the state is small, the writes
 * all funnel through one engine, and the interesting logic lives in src/core
 * where it is unit-tested directly rather than through the store.
 */

type Filter = OrderStatus | 'all';

export type ThemePreference = 'system' | 'light' | 'dark';

const THEME_KEY = 'theme_preference';

interface AppState {
  ready: boolean;
  loading: boolean;
  error: string | null;
  orders: Order[];
  /** The outbox, mirrored for the UI so rows can show their own sync state. */
  queue: OutboxEntry[];
  filter: Filter;
  /** Free-text search over customer, reference and address. */
  query: string;
  /** 'system' follows the device. The other two override it. */
  theme: ThemePreference;
  sync: SyncStatus | null;

  bootstrap: () => Promise<void>;
  refresh: () => Promise<void>;
  syncNow: () => Promise<void>;
  setFilter: (filter: Filter) => void;
  setQuery: (query: string) => void;
  setTheme: (theme: ThemePreference) => void;
  updateStatus: (input: StatusChangeInput) => Promise<void>;
  resolveReview: (orderId: string, chosen: OrderStatus) => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  ready: false,
  loading: false,
  error: null,
  orders: [],
  queue: [],
  filter: 'all',
  query: '',
  theme: 'system',
  sync: null,

  bootstrap: async () => {
    if (get().ready) return;
    // Cleared up front so a retry that succeeds does not leave the last
    // failure on screen.
    set({ loading: true, error: null });
    try {
      const { engine } = await initRuntime();
      engine.subscribe((sync) => {
        set({ sync });
        // The engine reports a new pending count whenever the queue changes, so
        // this is the cheapest correct place to re-read it.
        void get().refresh();
      });
      set({ ready: true });
      const saved = await getRuntime().store.getSetting(THEME_KEY);
      if (saved === 'light' || saved === 'dark' || saved === 'system') set({ theme: saved });
      await get().refresh();
      // Fire and forget: the driver can work from local data immediately and
      // does not wait on the network to see today's route.
      void engine.sync().then(() => get().refresh());
    } catch (error) {
      set({ error: describe(error) });
    } finally {
      set({ loading: false });
    }
  },

  refresh: async () => {
    const { store } = getRuntime();
    const [orders, queue] = await Promise.all([
      store.getOrders(),
      store.getAllOutboxEntries(),
    ]);
    set({ orders, queue });
  },

  syncNow: async () => {
    const { engine } = getRuntime();
    await engine.sync();
    await get().refresh();
  },

  setFilter: (filter) => set({ filter }),

  setQuery: (query) => set({ query }),

  setTheme: (theme) => {
    set({ theme });
    // Persisted so the choice survives a force-quit, like everything else here.
    void getRuntime().store.setSetting(THEME_KEY, theme);
  },

  updateStatus: async (input) => {
    const { engine } = getRuntime();
    try {
      await engine.recordStatusChange(input);
      await get().refresh();
    } catch (error) {
      set({ error: describe(error) });
      throw error;
    }
  },

  resolveReview: async (orderId, chosen) => {
    const { engine } = getRuntime();
    await engine.resolveReview(orderId, chosen);
    await get().refresh();
  },
}));

/**
 * These derive new arrays/objects on every call, so they must be read through
 * `useShallow` at the call site. Zustand 5 compares a selector's result with
 * Object.is; a freshly built array is never equal to the last one, so React
 * sees the snapshot change on every render and loops until it bails out.
 */
export function selectVisibleOrders(state: AppState): Order[] {
  const query = state.query.trim().toLowerCase();
  return state.orders.filter((order) => {
    if (state.filter !== 'all' && order.status !== state.filter) return false;
    if (!query) return true;
    // Searched against what a driver actually has to hand: a name shouted
    // through a door, a reference read off a label, or a street sign.
    return (
      order.customerName.toLowerCase().includes(query) ||
      order.reference.toLowerCase().includes(query) ||
      order.address.toLowerCase().includes(query)
    );
  });
}

export function selectReviewOrders(state: AppState): Order[] {
  return state.orders.filter((order) => order.needsReview);
}

export function selectCounts(state: AppState): Record<Filter, number> {
  const counts: Record<string, number> = { all: state.orders.length };
  for (const status of ['pending', 'confirmed', 'in_transit', 'delivered', 'failed']) {
    counts[status] = state.orders.filter((o) => o.status === status).length;
  }
  return counts as Record<Filter, number>;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
