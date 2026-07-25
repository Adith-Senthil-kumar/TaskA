import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet } from 'react-native';
import { useAppStore } from '../../src/store/useAppStore';
import { usePalette } from '../../src/ui/theme';

export default function TabsLayout() {
  const palette = usePalette();
  const pending = useAppStore((s) => s.sync?.pendingCount ?? 0);
  const reviews = useAppStore((s) => s.sync?.reviewCount ?? 0);
  const badge = pending + reviews;

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: palette.bar, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.sep },
        headerTitleStyle: { color: palette.ink, fontSize: 17, fontWeight: '600' },
        headerShadowVisible: false,
        tabBarStyle: { backgroundColor: palette.bar, borderTopColor: palette.sep },
        tabBarActiveTintColor: palette.tint,
        tabBarInactiveTintColor: palette.ink3,
        tabBarBadgeStyle: { backgroundColor: palette.or, fontSize: 11 },
        sceneStyle: { backgroundColor: palette.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Orders List',
          tabBarLabel: 'Orders',
          tabBarIcon: ({ color, size }) => <Ionicons name="list-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="outbox"
        options={{
          title: 'Outbox',
          // The count on the tab is the whole point of splitting this screen
          // out: how much the phone still owes the server is checked constantly
          // mid-shift, and it should never require opening anything to see.
          tabBarBadge: badge > 0 ? badge : undefined,
          tabBarIcon: ({ color, size }) => <Ionicons name="arrow-up-circle-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Settings/Profile',
          tabBarLabel: 'Profile',
          tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
