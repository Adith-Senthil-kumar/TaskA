import { useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { useAppStore } from '../../src/store/useAppStore';
import { Button, Card } from '../../src/ui/components';
import { usePalette } from '../../src/ui/theme';
import { API_BASE_URL } from '../../src/app/runtime';

/**
 * Profile. The screen a driver opens roughly once, on their first shift.
 *
 * The only load-bearing thing here is the sign-out guard: signing out with
 * unsent work would destroy it, so the app refuses to do it quietly.
 */
export default function ProfileScreen() {
  const palette = usePalette();
  const pending = useAppStore((s) => s.sync?.pendingCount ?? 0);
  const syncNow = useAppStore((s) => s.syncNow);
  const sync = useAppStore((s) => s.sync);
  const [syncing, setSyncing] = useState(false);

  const offline = sync?.connection === 'offline';
  const appVersion = Constants.expoConfig?.version ?? '1.0.0';

  const forceSync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      await syncNow();
    } finally {
      setSyncing(false);
    }
  };

  const signOut = () => {
    if (pending > 0) {
      Alert.alert(
        'You have work that has not been sent',
        `${pending} ${pending === 1 ? 'change is' : 'changes are'} still on this phone. Signing out now would lose ${pending === 1 ? 'it' : 'them'}.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Try to send first', onPress: () => void syncNow() },
        ],
      );
      return;
    }
    Alert.alert('Sign out', 'Everything is on the server. You can sign out safely.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => undefined },
    ]);
  };

  return (
    <ScrollView style={{ backgroundColor: palette.bg }} contentContainerStyle={{ paddingBottom: 40 }}>
      <Card>
        <View style={styles.identity}>
          <View style={[styles.avatar, { backgroundColor: palette.tintsoft }]}>
            <Text style={[styles.initials, { color: palette.tint }]}>DK</Text>
          </View>
          <View style={styles.flex}>
            <Text style={[styles.name, { color: palette.ink }]}>Dana Køhler</Text>
            <Text style={[styles.meta, { color: palette.ink2 }]}>Driver 2841 · Shift 06:30–15:00</Text>
          </View>
        </View>
      </Card>

      <Card>
        <Field label="Vehicle" value="Van 14 · LM 41 208" />
        <Field label="Depot" value="Northgate" />
        <Field label="Dispatch server" value={API_BASE_URL} />
        <Field label="App version" value={appVersion} />
      </Card>

      <Card>
        <View style={styles.pendingRow}>
          <View style={styles.flex}>
            <Text style={[styles.sectionTitle, { color: palette.ink }]}>Pending sync</Text>
            <Text style={[styles.sectionSub, { color: palette.ink2 }]}>
              {pending === 0
                ? 'Nothing is waiting. Every change has reached the server.'
                : `${pending} ${pending === 1 ? 'change is' : 'changes are'} saved here and not yet sent.`}
            </Text>
          </View>
          <Text
            style={[
              styles.pendingCount,
              { color: pending > 0 ? palette.or : palette.ink3 },
            ]}
          >
            {pending}
          </Text>
        </View>

        <View style={{ marginTop: 14 }}>
          <Button
            label={syncing ? 'Syncing…' : offline ? 'Force Sync — waiting for signal' : 'Force Sync'}
            variant="primary"
            onPress={forceSync}
            disabled={syncing || offline}
          />
        </View>
      </Card>

      <View style={styles.footer}>
        <Button label="Sign out" variant={pending > 0 ? 'secondary' : 'destructive'} onPress={signOut} />
      </View>

      <Pressable
        accessibilityRole="link"
        onPress={() => void Linking.openURL('https://digitalheroesco.com')}
        style={styles.credit}
      >
        <Text style={[styles.creditText, { color: palette.ink3 }]}>
          Built for Digital Heroes Training Task
        </Text>
      </Pressable>
    </ScrollView>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  const palette = usePalette();
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: palette.ink2 }]}>{label}</Text>
      <Text style={[styles.fieldValue, { color: palette.ink }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center' },
  initials: { fontSize: 20, fontWeight: '600' },
  name: { fontSize: 20, fontWeight: '700', letterSpacing: -0.4 },
  meta: { fontSize: 13, marginTop: 2 },
  field: { paddingVertical: 8 },
  fieldLabel: { fontSize: 12.5 },
  fieldValue: { fontSize: 15.5, marginTop: 2 },
  sectionTitle: { fontSize: 16, fontWeight: '600' },
  pendingRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  pendingCount: { fontSize: 30, fontWeight: '700', fontVariant: ['tabular-nums'], lineHeight: 34 },
  sectionSub: { fontSize: 13, marginTop: 4, lineHeight: 19 },
  footer: { paddingHorizontal: 16, paddingTop: 24 },
  credit: { paddingTop: 28, paddingBottom: 8, alignItems: 'center' },
  creditText: { fontSize: 12, textDecorationLine: 'underline' },
});
