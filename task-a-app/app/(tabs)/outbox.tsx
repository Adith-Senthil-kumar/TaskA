import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useShallow } from 'zustand/react/shallow';
import { selectReviewOrders, useAppStore } from '../../src/store/useAppStore';
import { Button, Card, Loading, Pill } from '../../src/ui/components';
import { usePalette } from '../../src/ui/theme';
import { STATUS_LABELS } from '../../src/core/statusMachine';

/**
 * The Outbox.
 *
 * Split out from Profile on the designer's argument, which I agree with: sync
 * is checked constantly mid-shift and settings almost never, so combining them
 * buries the thing that matters. This is the app's audit trail — every change
 * still on the phone, how long it has waited, and why it has not landed.
 */
export default function OutboxScreen() {
  const palette = usePalette();
  const { ready, sync, queue, syncNow } = useAppStore();
  const reviews = useAppStore(useShallow(selectReviewOrders));
  const orders = useAppStore((s) => s.orders);

  if (!ready) return <Loading label="Reading the queue" />;

  const offline = sync?.connection === 'offline';

  return (
    <ScrollView style={{ backgroundColor: palette.bg }} contentContainerStyle={{ paddingBottom: 40 }}>
      <Card>
        <View style={styles.connRow}>
          <View style={styles.flex}>
            <Text style={[styles.connTitle, { color: palette.ink }]}>
              {offline ? 'No signal' : 'Connected'}
            </Text>
            <Text style={[styles.connMeta, { color: palette.ink2 }]}>
              {sync?.lastSyncedAt
                ? `Last confirmed ${new Date(sync.lastSyncedAt).toLocaleTimeString()}`
                : 'Nothing confirmed this session yet'}
            </Text>
          </View>
          <Ionicons
            name={offline ? 'cloud-offline-outline' : 'cloud-done-outline'}
            size={24}
            color={offline ? palette.ink3 : palette.grn}
          />
        </View>
        <View style={{ marginTop: 12 }}>
          <Button
            label={offline ? 'Waiting for signal' : 'Sync now'}
            variant="primary"
            onPress={syncNow}
            disabled={offline || sync?.phase === 'syncing'}
          />
        </View>
      </Card>

      {reviews.length > 0 ? (
        <Card style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: palette.pur }}>
          <Text style={[styles.sectionTitle, { color: palette.ink }]}>
            {reviews.length === 1 ? 'One stop needs a decision' : `${reviews.length} stops need a decision`}
          </Text>
          <Text style={[styles.sectionSub, { color: palette.ink2 }]}>
            Nothing else is stuck behind it. Decide when you have a moment.
          </Text>
          {reviews.map((order) => (
            <View key={order.id} style={styles.reviewRow}>
              <View style={styles.flex}>
                <Text style={[styles.itemTitle, { color: palette.ink }]}>
                  {order.reference} · {order.customerName}
                </Text>
                <Text style={[styles.itemMeta, { color: palette.ink2 }]}>
                  You said {STATUS_LABELS[order.reviewSnapshot?.localStatus ?? order.status]}, the
                  server says {STATUS_LABELS[order.reviewSnapshot?.serverStatus ?? order.status]}
                </Text>
              </View>
              <Button
                label="Open"
                onPress={() => router.push({ pathname: '/order/[id]', params: { id: order.id } })}
              />
            </View>
          ))}
        </Card>
      ) : null}

      {queue.length === 0 ? (
        <Card>
          <View style={styles.caughtUp}>
            <View style={[styles.caughtIcon, { backgroundColor: palette.grnsoft }]}>
              <Ionicons name="checkmark" size={22} color={palette.grn} />
            </View>
            <Text style={[styles.sectionTitle, { color: palette.ink }]}>All caught up</Text>
            <Text style={[styles.sectionSub, { color: palette.ink2, textAlign: 'center' }]}>
              Everything you have done today is on the server. Nothing is left on this phone.
            </Text>
          </View>
        </Card>
      ) : (
        <Card>
          <Text style={[styles.sectionTitle, { color: palette.ink }]}>
            Waiting to send · {queue.length}
          </Text>
          <Text style={[styles.sectionSub, { color: palette.ink2 }]}>
            Sent oldest first, so the server never sees them out of order.
          </Text>
          {queue.map((entry) => {
            const order = orders.find((o) => o.id === entry.orderId);
            const failing = entry.attempts > 0;
            return (
              <View key={entry.id} style={[styles.queueRow, { borderTopColor: palette.sep }]}>
                <View style={styles.flex}>
                  <Text style={[styles.itemTitle, { color: palette.ink }]}>
                    Status → {STATUS_LABELS[entry.payload.status]}
                  </Text>
                  <Text style={[styles.itemMeta, { color: palette.ink2 }]}>
                    {order ? `${order.reference} · ${order.customerName}` : entry.orderId}
                  </Text>
                  <Text style={[styles.itemMeta, { color: palette.ink3 }]}>
                    saved {age(entry.createdAt)}
                    {failing
                      ? ` · ${entry.attempts} ${entry.attempts === 1 ? 'attempt' : 'attempts'}`
                      : ''}
                  </Text>
                  {entry.lastError ? (
                    <Text style={[styles.reason, { color: palette.red }]}>{entry.lastError}</Text>
                  ) : null}
                </View>
                <Pill
                  label={failing ? `Retry ${entry.attempts}` : offline ? 'Held' : 'Queued'}
                  tone={failing ? 'red' : 'or'}
                  pulse={false}
                />
              </View>
            );
          })}
        </Card>
      )}
    </ScrollView>
  );
}

function age(timestamp: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return 'moments ago';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m ago`;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  connRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  connTitle: { fontSize: 17, fontWeight: '600' },
  connMeta: { fontSize: 13, marginTop: 2 },
  sectionTitle: { fontSize: 16, fontWeight: '600' },
  sectionSub: { fontSize: 13, marginTop: 3, lineHeight: 18 },
  reviewRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14 },
  queueRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingTop: 14, marginTop: 14, borderTopWidth: StyleSheet.hairlineWidth },
  itemTitle: { fontSize: 15, fontWeight: '500' },
  itemMeta: { fontSize: 12.5, marginTop: 2 },
  reason: { fontSize: 12, marginTop: 4 },
  caughtUp: { alignItems: 'center', paddingVertical: 18, gap: 8 },
  caughtIcon: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
});
