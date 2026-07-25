import { useMemo } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { useShallow } from 'zustand/react/shallow';
import { selectCounts, selectVisibleOrders, useAppStore } from '../../src/store/useAppStore';
import {
  EmptyState,
  FilterChip,
  Loading,
  Separator,
  StatusCard,
  StatusLine,
  StopNumber,
  SyncBadge,
  type CardTone,
} from '../../src/ui/components';
import { usePalette } from '../../src/ui/theme';
import { entriesFor, rowBadge, syncKindFor } from '../../src/ui/syncKind';
import type { Order, OrderStatus, OutboxEntry, SyncStatus } from '../../src/core/types';

const FILTERS: { key: OrderStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'in_transit', label: 'In transit' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'failed', label: 'Failed' },
];

export default function RouteScreen() {
  const palette = usePalette();
  const { ready, loading, filter, setFilter, query, setQuery, syncNow, sync, queue, orders: all } =
    useAppStore();
  const orders = useAppStore(useShallow(selectVisibleOrders));
  const counts = useAppStore(useShallow(selectCounts));

  const done = useMemo(
    () => all.filter((o) => o.status === 'delivered' || o.status === 'failed').length,
    [all],
  );

  if (!ready && loading) return <Loading label="Reaching dispatch…" />;

  const card = describeStatus(sync);

  return (
    <View style={[styles.screen, { backgroundColor: palette.bg }]}>
      <FlatList
        data={orders}
        keyExtractor={(order) => order.id}
        ItemSeparatorComponent={Separator}
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={
          <RefreshControl refreshing={sync?.phase === 'syncing'} onRefresh={syncNow} tintColor={palette.ink3} />
        }
        ListHeaderComponent={
          <View>
            <View style={styles.headline}>
              <Text style={[styles.progress, { color: palette.ink }]}>
                {done}
                <Text style={{ color: palette.ink3 }}>/{all.length}</Text>
              </Text>
              <Text style={[styles.progressLabel, { color: palette.ink2 }]}>stops done</Text>
            </View>

            <StatusCard
              cardTone={card.tone}
              title={card.title}
              meta={card.meta}
              actionLabel={card.action}
              onAction={card.action ? syncNow : undefined}
            />

            <View style={[styles.searchWrap, { backgroundColor: palette.card }]}>
              <Ionicons name="search" size={16} color={palette.ink3} />
              <TextInput
                style={[styles.search, { color: palette.ink }]}
                placeholder="Search name, reference or street"
                placeholderTextColor={palette.ink3}
                value={query}
                onChangeText={setQuery}
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="search"
                clearButtonMode="while-editing"
                accessibilityLabel="Search orders"
              />
              {query.length > 0 ? (
                <Pressable onPress={() => setQuery('')} accessibilityLabel="Clear search" hitSlop={10}>
                  <Ionicons name="close-circle" size={17} color={palette.ink3} />
                </Pressable>
              ) : null}
            </View>

            <View style={styles.filters}>
              {FILTERS.map((f) => (
                <FilterChip
                  key={f.key}
                  label={f.label}
                  count={counts[f.key] ?? 0}
                  active={filter === f.key}
                  onPress={() => setFilter(f.key)}
                />
              ))}
            </View>
          </View>
        }
        ListEmptyComponent={
          all.length === 0 ? (
            <EmptyState
              title="No route yet"
              body="Nothing has been assigned to you. Pull down to check again."
              actionLabel="Check again"
              onAction={syncNow}
            />
          ) : query.trim() ? (
            <EmptyState
              title="No match"
              body={`Nothing in today's ${all.length} stops matches “${query.trim()}”.`}
              actionLabel="Clear search"
              onAction={() => setQuery('')}
            />
          ) : (
            // Deliberately distinct from having no work at all. Telling a driver
            // with twelve stops that they have none would be a lie.
            <EmptyState
              title={`Nothing ${labelFor(filter)}`}
              body={`You have ${all.length} stops today, none in this state.`}
              actionLabel={`Show all ${all.length} stops`}
              onAction={() => setFilter('all')}
            />
          )
        }
        renderItem={({ item, index }) => (
          <OrderRow order={item} index={index} queue={queue} sync={sync} />
        )}
      />
    </View>
  );
}

function OrderRow({
  order,
  index,
  queue,
  sync,
}: {
  order: Order;
  index: number;
  queue: OutboxEntry[];
  sync: SyncStatus | null;
}) {
  const palette = usePalette();
  const kind = syncKindFor(order, queue, sync);
  const badge = rowBadge(kind, entriesFor(order.id, queue));
  const finished = order.status === 'delivered' || order.status === 'failed';
  const items = order.items.reduce((total, item) => total + item.quantity, 0);

  return (
    // The layout lives on an inner View, not on the Pressable. `Link asChild`
    // renders through a Radix Slot, which merges the child's `style` by object
    // spread - a Pressable style *function* spreads to {} and every rule is
    // silently dropped. The children-as-function form gives the same pressed
    // feedback and survives the merge.
    <Link href={{ pathname: '/order/[id]', params: { id: order.id } }} asChild>
      <Pressable>
        {({ pressed }) => (
          <View style={[styles.row, { backgroundColor: pressed ? palette.fill : palette.card }]}>
            <StopNumber n={index + 1} finished={finished} />

            <View style={styles.rowBody}>
              <View style={styles.rowTop}>
                <Text style={[styles.name, { color: palette.ink }]} numberOfLines={1}>
                  {order.customerName}
                </Text>
                <Text style={[styles.reference, { color: palette.ink3 }]}>{order.reference}</Text>
              </View>
              <Text style={[styles.address, { color: palette.ink2 }]} numberOfLines={1}>
                {order.address}
              </Text>
              <StatusLine
                status={order.status}
                meta={`${items} ${items === 1 ? 'item' : 'items'} · ${order.deliveryWindow}`}
              />
            </View>

            <View style={styles.rowRight}>
              {badge ? <SyncBadge spec={badge} /> : null}
              <Ionicons name="chevron-forward" size={16} color={palette.ink3} />
            </View>
          </View>
        )}
      </Pressable>
    </Link>
  );
}

function describeStatus(sync: SyncStatus | null): {
  tone: CardTone;
  title: string;
  meta: string;
  action?: string;
} {
  if (!sync) return { tone: 'synced', title: 'Starting up', meta: 'reading what is on this phone' };

  if (sync.connection === 'offline') {
    return {
      tone: 'offline',
      title: 'No signal',
      meta:
        sync.pendingCount > 0
          ? `${sync.pendingCount} ${sync.pendingCount === 1 ? 'change' : 'changes'} saved here, nothing lost`
          : 'everything you had done was already sent',
    };
  }
  if (sync.phase === 'syncing') {
    return { tone: 'sending', title: 'Sending', meta: `${sync.pendingCount} left to go` };
  }
  if (sync.phase === 'error') {
    return {
      tone: 'failed',
      title: 'The server refused something',
      meta: sync.lastError ?? 'it will be retried',
      action: 'Retry',
    };
  }
  if (sync.pendingCount > 0) {
    return {
      tone: 'sending',
      title: `${sync.pendingCount} to send`,
      meta: 'waiting for a moment of signal',
      action: 'Send now',
    };
  }
  return {
    tone: 'caught_up',
    title: 'All caught up',
    meta: sync.lastSyncedAt
      ? `server confirmed ${timeAgo(sync.lastSyncedAt)}`
      : 'everything is on the server',
  };
}

function labelFor(filter: OrderStatus | 'all'): string {
  const found = FILTERS.find((f) => f.key === filter);
  return found ? found.label.toLowerCase() : 'here';
}

function timeAgo(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m ago`;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  headline: { flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingHorizontal: 16, paddingTop: 12 },
  progress: { fontSize: 34, fontWeight: '700', letterSpacing: -1, fontVariant: ['tabular-nums'] },
  progressLabel: { fontSize: 15 },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 16,
    paddingHorizontal: 12,
    height: 40,
    borderRadius: 10,
  },
  search: { flex: 1, fontSize: 15.5, paddingVertical: 0 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  rowBody: { flex: 1, minWidth: 0 },
  rowTop: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  name: { fontSize: 16, fontWeight: '600', letterSpacing: -0.2, flexShrink: 1 },
  reference: { fontSize: 11.5, fontVariant: ['tabular-nums'] },
  address: { fontSize: 13.5, marginTop: 1 },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
