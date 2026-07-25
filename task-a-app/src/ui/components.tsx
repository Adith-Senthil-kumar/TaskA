import { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { STATUS_LABELS } from '../core/statusMachine';
import type { OrderStatus } from '../core/types';
import { HIT, radius, usePalette, type Palette } from './theme';
import type { BadgeSpec } from './syncKind';

/** Status hue. Ranked colours, so the journey reads as progress. */
export function statusColor(palette: Palette, status: OrderStatus): string {
  switch (status) {
    case 'pending':
      return palette.gray;
    case 'confirmed':
      return palette.tint;
    case 'in_transit':
      return palette.ind;
    case 'delivered':
      return palette.grn;
    case 'failed':
      return palette.red;
  }
}

function tone(palette: Palette, t: BadgeSpec['tone'] | 'neutral') {
  switch (t) {
    case 'or':
      return { bg: palette.orsoft, fg: palette.or };
    case 'red':
      return { bg: palette.redsoft, fg: palette.red };
    case 'pur':
      return { bg: palette.pursoft, fg: palette.pur };
    case 'neutral':
      return { bg: palette.fill, fg: palette.ink2 };
  }
}

/** Slow opacity pulse for the "Sending" state. Native-driven, so it costs nothing. */
function usePulse(active: boolean) {
  const value = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!active) {
      value.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, { toValue: 0.35, duration: 500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(value, { toValue: 1, duration: 500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, value]);
  return value;
}

export function SyncBadge({ spec }: { spec: BadgeSpec }) {
  const palette = usePalette();
  const { bg, fg } = tone(palette, spec.tone);
  const opacity = usePulse(spec.pulse);

  return (
    <Animated.View style={[styles.badge, { backgroundColor: bg, opacity }]}>
      <Ionicons name="arrow-up" size={10} color={fg} />
      <Text style={[styles.badgeText, { color: fg }]}>{spec.label}</Text>
    </Animated.View>
  );
}

export function Pill({
  label,
  tone: t,
  pulse,
}: {
  label: string;
  tone: BadgeSpec['tone'] | 'neutral';
  pulse: boolean;
}) {
  const palette = usePalette();
  const { bg, fg } = tone(palette, t);
  const opacity = usePulse(pulse);
  return (
    <Animated.View style={[styles.pill, { backgroundColor: bg, opacity }]}>
      <Text style={[styles.pillText, { color: fg }]}>{label}</Text>
    </Animated.View>
  );
}

export function StatusLine({ status, meta }: { status: OrderStatus; meta?: string }) {
  const palette = usePalette();
  const color = statusColor(palette, status);
  return (
    <View style={styles.statusLine}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.statusText, { color }]}>{STATUS_LABELS[status]}</Text>
      {meta ? (
        <Text style={[styles.statusMeta, { color: palette.ink3 }]} numberOfLines={1}>
          · {meta}
        </Text>
      ) : null}
    </View>
  );
}

export type CardTone = 'offline' | 'sending' | 'failed' | 'caught_up' | 'synced';

/**
 * The one status card at the top of the route.
 *
 * The design's rule is that there is no permanent warning chrome — this card is
 * the single place the app makes a claim about what the server has, and it is
 * required to be honest. Offline is grey because it is a fact, not a failure.
 */
export function StatusCard({
  cardTone,
  title,
  meta,
  actionLabel,
  onAction,
}: {
  cardTone: CardTone;
  title: string;
  meta: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const palette = usePalette();

  const spec: Record<CardTone, { bg: string; fg: string; iconBg: string; iconFg: string; icon: keyof typeof Ionicons.glyphMap }> = {
    offline: { bg: palette.card, fg: palette.ink2, iconBg: palette.fill2, iconFg: palette.ink2, icon: 'cloud-offline-outline' },
    sending: { bg: palette.orsoft, fg: palette.or, iconBg: palette.or, iconFg: '#FFFFFF', icon: 'arrow-up' },
    failed: { bg: palette.redsoft, fg: palette.red, iconBg: palette.red, iconFg: '#FFFFFF', icon: 'alert-outline' },
    caught_up: { bg: palette.grnsoft, fg: palette.grn, iconBg: palette.grn, iconFg: '#FFFFFF', icon: 'checkmark' },
    synced: { bg: palette.card, fg: palette.ink2, iconBg: palette.fill2, iconFg: palette.ink2, icon: 'checkmark' },
  };
  const s = spec[cardTone];
  const opacity = usePulse(cardTone === 'sending');

  return (
    <Animated.View style={[styles.statusCard, { backgroundColor: s.bg, opacity }]}>
      <View style={[styles.statusIcon, { backgroundColor: s.iconBg }]}>
        <Ionicons name={s.icon} size={14} color={s.iconFg} />
      </View>
      <View style={styles.flex}>
        <Text style={[styles.statusCardTitle, { color: cardTone === 'synced' || cardTone === 'offline' ? palette.ink : s.fg }]}>
          {title}
        </Text>
        <Text style={[styles.statusCardMeta, { color: palette.ink2 }]}>{meta}</Text>
      </View>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} hitSlop={8} style={styles.statusAction}>
          <Text style={[styles.statusActionText, { color: palette.tint }]}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

export function FilterChip({
  label,
  count,
  active,
  onPress,
}: {
  label: string;
  count: number;
  active: boolean;
  onPress: () => void;
}) {
  const palette = usePalette();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[
        styles.chip,
        {
          backgroundColor: active ? palette.ink : palette.card,
          borderColor: active ? palette.ink : palette.sep,
        },
      ]}
    >
      <Text style={[styles.chipLabel, { color: active ? palette.bg : palette.ink }]}>{label}</Text>
      <Text style={[styles.chipCount, { color: active ? palette.bg : palette.ink3 }]}>{count}</Text>
    </Pressable>
  );
}

export function StopNumber({ n, finished }: { n: number; finished: boolean }) {
  const palette = usePalette();
  return (
    <View style={[styles.stop, { backgroundColor: finished ? palette.fill : palette.tintsoft }]}>
      <Text style={[styles.stopText, { color: finished ? palette.ink3 : palette.tint }]}>
        {n < 10 ? `0${n}` : n}
      </Text>
    </View>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const palette = usePalette();
  return <View style={[styles.card, { backgroundColor: palette.card }, style]}>{children}</View>;
}

export function Row({ label, value }: { label: string; value: string }) {
  const palette = usePalette();
  return (
    <View style={styles.kvRow}>
      <Text style={[styles.kvLabel, { color: palette.ink2 }]}>{label}</Text>
      <Text style={[styles.kvValue, { color: palette.ink }]}>{value}</Text>
    </View>
  );
}

export function Button({
  label,
  onPress,
  variant = 'secondary',
  disabled,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'destructive' | 'quiet';
  disabled?: boolean;
}) {
  const palette = usePalette();
  const background =
    variant === 'primary' ? palette.tint
    : variant === 'destructive' ? palette.red
    : variant === 'quiet' ? 'transparent'
    : palette.card;
  const color = variant === 'primary' || variant === 'destructive' ? '#FFFFFF' : palette.tint;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: background,
          opacity: disabled ? 0.35 : pressed ? 0.75 : 1,
          borderWidth: variant === 'secondary' ? StyleSheet.hairlineWidth : 0,
          borderColor: palette.sep,
        },
      ]}
    >
      <Text style={[styles.buttonText, { color }]}>{label}</Text>
    </Pressable>
  );
}

export function EmptyState({
  title,
  body,
  actionLabel,
  onAction,
}: {
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const palette = usePalette();
  return (
    <View style={styles.empty}>
      <Text style={[styles.emptyTitle, { color: palette.ink }]}>{title}</Text>
      <Text style={[styles.emptyBody, { color: palette.ink2 }]}>{body}</Text>
      {actionLabel && onAction ? (
        <View style={styles.emptyAction}>
          <Button label={actionLabel} onPress={onAction} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * A failure the driver cannot work around, with the only useful action next to
 * it. Distinct from EmptyState because "there is nothing here" and "this is
 * broken" are different messages, and only one of them is red.
 */
export function ErrorState({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry?: () => void;
}) {
  const palette = usePalette();
  return (
    <View style={[errorStyles.wrap, { backgroundColor: palette.bg }]}>
      <View style={[errorStyles.icon, { backgroundColor: palette.redsoft }]}>
        <Ionicons name="alert-circle-outline" size={26} color={palette.red} />
      </View>
      <Text style={[errorStyles.title, { color: palette.ink }]}>{title}</Text>
      <Text style={[errorStyles.body, { color: palette.ink2 }]}>{message}</Text>
      {onRetry ? (
        <View style={errorStyles.action}>
          <Button label="Try again" variant="primary" onPress={onRetry} />
        </View>
      ) : null}
      <FooterCredit />
    </View>
  );
}

const errorStyles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  icon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  title: { fontSize: 19, fontWeight: '700', textAlign: 'center' },
  body: { fontSize: 14, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  action: { alignSelf: 'stretch', marginTop: 22 },
});

export function Loading({ label }: { label: string }) {
  const palette = usePalette();
  return (
    <View style={[styles.empty, { backgroundColor: palette.bg }]}>
      <ActivityIndicator color={palette.ink3} />
      <Text style={[styles.emptyBody, { color: palette.ink2, marginTop: 14 }]}>{label}</Text>
    </View>
  );
}

export function Separator() {
  const palette = usePalette();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: palette.sep, marginLeft: 62 }} />;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: radius.chip,
  },
  badgeText: { fontSize: 11, fontWeight: '600' },
  pill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.chip, alignSelf: 'flex-start' },
  pillText: { fontSize: 12, fontWeight: '600' },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontSize: 12, fontWeight: '500' },
  statusMeta: { fontSize: 12, flexShrink: 1 },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: radius.card,
    marginHorizontal: 16,
    marginTop: 8,
  },
  statusIcon: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  statusCardTitle: { fontSize: 15, fontWeight: '600', letterSpacing: -0.2 },
  statusCardMeta: { fontSize: 12.5, marginTop: 1 },
  statusAction: { paddingHorizontal: 4, minHeight: 32, justifyContent: 'center' },
  statusActionText: { fontSize: 15, fontWeight: '600' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    minHeight: 34,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipLabel: { fontSize: 13, fontWeight: '500' },
  chipCount: { fontSize: 13, fontVariant: ['tabular-nums'] },
  stop: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  stopText: { fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  card: { borderRadius: radius.card, padding: 14, marginHorizontal: 16, marginTop: 12 },
  kvRow: { paddingVertical: 8 },
  kvLabel: { fontSize: 12.5 },
  kvValue: { fontSize: 15.5, marginTop: 2, lineHeight: 21 },
  button: {
    minHeight: HIT,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  buttonText: { fontSize: 16, fontWeight: '600' },
  empty: { flex: 1, padding: 36, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: 17, fontWeight: '600', marginBottom: 6, textAlign: 'center' },
  emptyBody: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  emptyAction: { marginTop: 18, alignSelf: 'stretch' },
});

export const CREDIT_TEXT = 'Built for Digital Heroes Training Task';
export const CREDIT_URL = 'https://digitalheroesco.com';

/**
 * The attribution required by the brief. It appears on every screen rather than
 * only on Profile, because the requirement is about the page a reviewer happens
 * to open, and on web every route is a page someone can land on directly.
 *
 * On web it renders a real anchor so the destination is visible on hover and
 * survives being right-clicked; elsewhere it is a Pressable that opens the same
 * URL. Both paths are the same line of text.
 */
export function FooterCredit({ compact = false }: { compact?: boolean } = {}) {
  const palette = usePalette();
  const open = () => void Linking.openURL(CREDIT_URL);

  const label = (
    <Text style={[creditStyles.text, { color: palette.ink3 }]}>{CREDIT_TEXT}</Text>
  );

  if (Platform.OS === 'web') {
    return (
      <View style={[creditStyles.wrap, compact && creditStyles.compact]}>
        <Text
          accessibilityRole="link"
          // RNW turns `href` into a real <a>. Not in the React Native Text
          // types, which is why this is cast rather than spread blindly.
          {...({ href: CREDIT_URL, hrefAttrs: { rel: 'noopener', target: '_blank' } } as object)}
          style={[creditStyles.text, { color: palette.ink3 }]}
        >
          {CREDIT_TEXT}
        </Text>
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="link"
      onPress={open}
      style={[creditStyles.wrap, compact && creditStyles.compact]}
    >
      {label}
    </Pressable>
  );
}

const creditStyles = StyleSheet.create({
  wrap: { paddingTop: 24, paddingBottom: 12, alignItems: 'center' },
  compact: { paddingTop: 10, paddingBottom: 10 },
  text: { fontSize: 12, textDecorationLine: 'underline', textAlign: 'center' },
});
