import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useAppStore } from '../../../src/store/useAppStore';
import { Button, EmptyState } from '../../../src/ui/components';
import { radius, usePalette } from '../../../src/ui/theme';
import { STATUS_LABELS, allowedNextStatuses } from '../../../src/core/statusMachine';
import type { FailureReason, OrderStatus } from '../../../src/core/types';

const REASONS: { key: FailureReason; label: string }[] = [
  { key: 'nobody_home', label: 'Nobody home' },
  { key: 'refused', label: 'Refused' },
  { key: 'access_problem', label: 'Access problem' },
  { key: 'damaged', label: 'Damaged' },
];

const HINTS: Partial<Record<OrderStatus, string>> = {
  confirmed: 'You have the parcel and it is on the van',
  in_transit: 'You are on the way to this stop',
  delivered: 'Handed over, or left where the customer asked',
  failed: 'You could not complete it',
};

export default function StatusUpdateScreen() {
  const palette = usePalette();
  const { id } = useLocalSearchParams<{ id: string }>();
  const order = useAppStore((s) => s.orders.find((o) => o.id === id));
  const updateStatus = useAppStore((s) => s.updateStatus);
  const connection = useAppStore((s) => s.sync?.connection ?? 'offline');

  const [status, setStatus] = useState<OrderStatus | null>(null);
  const [reason, setReason] = useState<FailureReason | null>(null);
  const [notes, setNotes] = useState('');
  const [recipient, setRecipient] = useState('');
  const [photo, setPhoto] = useState(false);
  const [saving, setSaving] = useState(false);

  if (!order) return <EmptyState title="Stop not found" body="Go back and pick it again." />;

  const options = allowedNextStatuses(order.status);
  const needsReason = status === 'failed';
  const canSave = status !== null && (!needsReason || reason !== null);

  const save = async () => {
    if (!status || saving) return;
    setSaving(true);
    try {
      await updateStatus({
        orderId: order.id,
        status,
        failure: needsReason && reason ? { reason, notes: notes.trim() || undefined } : undefined,
        proof:
          status === 'delivered' && (recipient.trim() || photo)
            ? {
                recipientName: recipient.trim() || undefined,
                photoUri: photo ? `file://local/${order.id}.jpg` : undefined,
              }
            : undefined,
      });
      router.back();
    } catch (error) {
      Alert.alert('Could not save', error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView
      style={{ backgroundColor: palette.bg }}
      contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.name, { color: palette.ink }]}>{order.customerName}</Text>
      <Text style={[styles.meta, { color: palette.ink3 }]}>
        {order.reference} · currently {STATUS_LABELS[order.status].toLowerCase()}
      </Text>

      <Text style={[styles.question, { color: palette.ink }]}>What happened here?</Text>
      {options.map((option) => (
        <Choice
          key={option}
          label={STATUS_LABELS[option]}
          hint={HINTS[option]}
          selected={status === option}
          destructive={option === 'failed'}
          onPress={() => setStatus(option)}
        />
      ))}

      {needsReason ? (
        <>
          <Text style={[styles.question, { color: palette.ink }]}>Why not?</Text>
          {REASONS.map((r) => (
            <Choice
              key={r.key}
              label={r.label}
              selected={reason === r.key}
              onPress={() => setReason(r.key)}
            />
          ))}
          <TextInput
            style={[styles.input, { backgroundColor: palette.card, color: palette.ink, borderColor: palette.sep }]}
            placeholder="Anything worth recording"
            placeholderTextColor={palette.ink3}
            value={notes}
            onChangeText={setNotes}
            multiline
          />
        </>
      ) : null}

      {status === 'delivered' ? (
        <>
          <View style={styles.questionRow}>
            <Text style={[styles.question, { color: palette.ink }]}>Proof</Text>
            <Text style={[styles.optional, { color: palette.ink3 }]}>optional</Text>
          </View>
          <TextInput
            style={[styles.input, { backgroundColor: palette.card, color: palette.ink, borderColor: palette.sep }]}
            placeholder="Who took it?"
            placeholderTextColor={palette.ink3}
            value={recipient}
            onChangeText={setRecipient}
          />
          <Pressable
            onPress={() => setPhoto((p) => !p)}
            style={[styles.photo, { backgroundColor: palette.card, borderColor: photo ? palette.tint : palette.sep }]}
          >
            <Ionicons name={photo ? 'checkmark-circle' : 'camera-outline'} size={22} color={photo ? palette.tint : palette.ink2} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.photoLabel, { color: palette.ink }]}>
                {photo ? 'Photo attached' : 'Take a photo'}
              </Text>
              <Text style={[styles.photoMeta, { color: palette.ink3 }]}>
                {photo ? '1.4 MB · not uploaded yet' : 'Stays on the phone until it is sent'}
              </Text>
            </View>
          </Pressable>
        </>
      ) : null}

      <View style={styles.footer}>
        <Button
          label={saving ? 'Saving…' : 'Save'}
          variant="primary"
          onPress={save}
          disabled={!canSave || saving}
        />
        <Text style={[styles.reassurance, { color: palette.ink2 }]}>
          {connection === 'offline'
            ? 'No signal here. This saves on the phone and sends itself when you get signal.'
            : 'Saves on the phone first, then sends.'}
        </Text>
      </View>
    </ScrollView>
  );
}

function Choice({
  label,
  hint,
  selected,
  destructive,
  onPress,
}: {
  label: string;
  hint?: string;
  selected: boolean;
  destructive?: boolean;
  onPress: () => void;
}) {
  const palette = usePalette();
  const accent = destructive ? palette.red : palette.tint;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={[
        styles.choice,
        {
          backgroundColor: palette.card,
          borderColor: selected ? accent : palette.sep,
          borderWidth: selected ? 2 : StyleSheet.hairlineWidth,
        },
      ]}
    >
      <View style={{ flex: 1 }}>
        <Text style={[styles.choiceLabel, { color: selected ? accent : palette.ink }]}>{label}</Text>
        {hint ? <Text style={[styles.choiceHint, { color: palette.ink3 }]}>{hint}</Text> : null}
      </View>
      {selected ? <Ionicons name="checkmark-circle" size={22} color={accent} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  name: { fontSize: 24, fontWeight: '700', letterSpacing: -0.5 },
  meta: { fontSize: 13, marginTop: 3 },
  question: { fontSize: 17, fontWeight: '600', marginTop: 26, marginBottom: 10 },
  questionRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  optional: { fontSize: 13 },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 58,
    borderRadius: radius.control,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 8,
  },
  choiceLabel: { fontSize: 16, fontWeight: '600' },
  choiceHint: { fontSize: 12.5, marginTop: 2 },
  input: {
    borderRadius: radius.control,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    fontSize: 15.5,
    minHeight: 52,
    marginTop: 8,
  },
  photo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: radius.control,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    marginTop: 8,
  },
  photoLabel: { fontSize: 15, fontWeight: '500' },
  photoMeta: { fontSize: 12, marginTop: 2 },
  footer: { marginTop: 28, gap: 12 },
  reassurance: { fontSize: 13, textAlign: 'center', lineHeight: 18 },
});
