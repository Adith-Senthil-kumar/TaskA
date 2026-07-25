import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useAppStore } from '../../../src/store/useAppStore';
import { getRuntime } from '../../../src/app/runtime';
import { Button, Card, EmptyState, Loading, Pill, Row, StatusLine } from '../../../src/ui/components';
import { usePalette } from '../../../src/ui/theme';
import { detailPill, syncKindFor } from '../../../src/ui/syncKind';
import { STATUS_LABELS, allowedNextStatuses } from '../../../src/core/statusMachine';
import type { StatusChange } from '../../../src/core/types';

export default function OrderDetailScreen() {
  const palette = usePalette();
  const { id } = useLocalSearchParams<{ id: string }>();
  const order = useAppStore((s) => s.orders.find((o) => o.id === id));
  const queue = useAppStore((s) => s.queue);
  const sync = useAppStore((s) => s.sync);
  const resolveReview = useAppStore((s) => s.resolveReview);
  const ready = useAppStore((s) => s.ready);
  const [history, setHistory] = useState<StatusChange[] | null>(null);

  useEffect(() => {
    if (!ready || !id) return;
    void getRuntime().store.getStatusHistory(id).then(setHistory);
  }, [ready, id, order?.updatedAt]);

  if (!ready) return <Loading label="Opening the stop" />;
  if (!order) {
    return (
      <EmptyState
        title="Not on this phone"
        body="This stop may have been reassigned. Pull to refresh the route when you have signal."
      />
    );
  }

  const waiting = queue.filter((entry) => entry.orderId === order.id).length;
  const lastSyncedChange = (history ?? []).find((change) => change.synced);
  const lastSync = waiting > 0
    ? `Waiting for sync · ${waiting} ${waiting === 1 ? 'change' : 'changes'} held`
    : lastSyncedChange
      ? formatStamp(lastSyncedChange.recordedAt)
      : formatStamp(order.updatedAt);

  const kind = syncKindFor(order, queue, sync);
  const pill = detailPill(kind);
  const items = order.items.reduce((total, item) => total + item.quantity, 0);
  const canUpdate = allowedNextStatuses(order.status).length > 0;

  return (
    <ScrollView style={{ backgroundColor: palette.bg }} contentContainerStyle={{ paddingBottom: 40 }}>
      <View style={styles.header}>
        <Text style={[styles.name, { color: palette.ink }]}>{order.customerName}</Text>
        <Text style={[styles.reference, { color: palette.ink3 }]}>{order.reference}</Text>
        <View style={styles.headerRow}>
          <StatusLine status={order.status} />
          <Pill label={pill.label} tone={pill.tone} pulse={pill.pulse} />
        </View>
      </View>

      {order.needsReview && order.reviewSnapshot ? (
        <Card style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: palette.pur }}>
          <Text style={[styles.conflictTitle, { color: palette.ink }]}>Two versions of this stop</Text>

          <View style={[styles.version, { backgroundColor: palette.fill }]}>
            <Text style={[styles.versionLabel, { color: palette.ink2 }]}>On your phone</Text>
            <Text style={[styles.versionStatus, { color: palette.ink }]}>
              {STATUS_LABELS[order.reviewSnapshot.localStatus]}
            </Text>
            <Text style={[styles.versionMeta, { color: palette.ink3 }]}>
              {new Date(order.reviewSnapshot.localRecordedAt).toLocaleTimeString()}
            </Text>
          </View>

          <View style={[styles.version, { backgroundColor: palette.fill }]}>
            <Text style={[styles.versionLabel, { color: palette.ink2 }]}>On the server</Text>
            <Text style={[styles.versionStatus, { color: palette.ink }]}>
              {STATUS_LABELS[order.reviewSnapshot.serverStatus]}
            </Text>
            <Text style={[styles.versionMeta, { color: palette.ink3 }]}>
              {new Date(order.reviewSnapshot.serverUpdatedAt).toLocaleTimeString()}
            </Text>
          </View>

          <View style={styles.conflictActions}>
            <Button
              label={`Keep mine — ${STATUS_LABELS[order.reviewSnapshot.localStatus]}`}
              variant="primary"
              onPress={() => resolveReview(order.id, order.reviewSnapshot!.localStatus)}
            />
            <Button
              label={`Use the server's — ${STATUS_LABELS[order.reviewSnapshot.serverStatus]}`}
              onPress={() => resolveReview(order.id, order.reviewSnapshot!.serverStatus)}
            />
          </View>

          <Text style={[styles.accountability, { color: palette.ink3 }]}>
            Your choice is recorded as a decision, with your name on it.
          </Text>
        </Card>
      ) : null}

      <Card>
        <Row label="Address" value={`${order.address}`} />
        <Row label="Window · Phone" value={`${order.deliveryWindow} · ${order.customerPhone}`} />
        {order.notes ? (
          <View style={{ paddingVertical: 8 }}>
            <Text style={[styles.kvLabel, { color: palette.ink2 }]}>Note from customer</Text>
            <Text style={[styles.note, { color: palette.ink }]}>“{order.notes}”</Text>
          </View>
        ) : null}
      </Card>

      <Card>
        <Row label="Order status" value={STATUS_LABELS[order.status]} />
        <Row label="Created" value={formatStamp(order.createdAt)} />
        <Row label="Last sync time" value={lastSync} />
      </Card>

      <Card>
        <Text style={[styles.sectionTitle, { color: palette.ink }]}>
          Products · {items} {items === 1 ? 'item' : 'items'}
        </Text>
        {order.items.map((item) => (
          <View key={item.sku} style={styles.itemRow}>
            <Text style={[styles.itemQty, { color: palette.ink2 }]}>×{item.quantity}</Text>
            <View style={{ flex: 1 }}>
              <Text style={[styles.itemName, { color: palette.ink }]}>{item.name}</Text>
              <Text style={[styles.itemSku, { color: palette.ink3 }]}>{item.sku}</Text>
            </View>
          </View>
        ))}
      </Card>

      <Card>
        <Text style={[styles.sectionTitle, { color: palette.ink }]}>History</Text>
        <Text style={[styles.sectionSub, { color: palette.ink2 }]}>
          Every change, and whether the server has it.
        </Text>
        {history === null ? (
          <Text style={[styles.itemSku, { color: palette.ink3, marginTop: 8 }]}>Reading…</Text>
        ) : history.length === 0 ? (
          <Text style={[styles.itemSku, { color: palette.ink3, marginTop: 8 }]}>
            Nothing recorded on this phone yet.
          </Text>
        ) : (
          history.map((change) => (
            <View key={change.id} style={styles.itemRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.itemName, { color: palette.ink }]}>
                  {STATUS_LABELS[change.status]}
                </Text>
                <Text style={[styles.itemSku, { color: palette.ink3 }]}>
                  {new Date(change.recordedAt).toLocaleTimeString()}
                  {change.failure ? ` · ${change.failure.reason.replace(/_/g, ' ')}` : ''}
                </Text>
              </View>
              <Text style={[styles.syncLabel, { color: change.synced ? palette.ink3 : palette.or }]}>
                {change.synced ? 'on the server' : 'on this phone'}
              </Text>
            </View>
          ))
        )}
      </Card>

      <View style={styles.footer}>
        {canUpdate ? (
          <Button
            label="Update status"
            variant="primary"
            onPress={() => router.push({ pathname: '/order/[id]/status', params: { id: order.id } })}
          />
        ) : (
          <Text style={[styles.finalNote, { color: palette.ink3 }]}>
            This stop is finished. A final status cannot be changed.
          </Text>
        )}
      </View>
    </ScrollView>
  );
}

function formatStamp(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return sameDay ? `Today ${time}` : `${d.toLocaleDateString()} ${time}`;
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingTop: 4 },
  name: { fontSize: 28, fontWeight: '700', letterSpacing: -0.6 },
  reference: { fontSize: 13, marginTop: 2, fontVariant: ['tabular-nums'] },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  conflictTitle: { fontSize: 17, fontWeight: '700', marginBottom: 10 },
  version: { borderRadius: 10, padding: 12, marginBottom: 8 },
  versionLabel: { fontSize: 12 },
  versionStatus: { fontSize: 17, fontWeight: '600', marginTop: 3 },
  versionMeta: { fontSize: 12, marginTop: 2, fontVariant: ['tabular-nums'] },
  conflictActions: { gap: 8, marginTop: 6 },
  accountability: { fontSize: 12, marginTop: 12, lineHeight: 17 },
  kvLabel: { fontSize: 12.5 },
  note: { fontSize: 15.5, marginTop: 3, lineHeight: 21, fontStyle: 'italic' },
  sectionTitle: { fontSize: 16, fontWeight: '600' },
  sectionSub: { fontSize: 12.5, marginTop: 2 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  itemQty: { fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'], minWidth: 28 },
  itemName: { fontSize: 15 },
  itemSku: { fontSize: 12, marginTop: 1 },
  syncLabel: { fontSize: 12, fontWeight: '500' },
  footer: { paddingHorizontal: 16, paddingTop: 20 },
  finalNote: { fontSize: 13, textAlign: 'center', lineHeight: 19 },
});
