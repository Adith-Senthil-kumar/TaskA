import { useEffect, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useAppStore } from '../src/store/useAppStore';
import { usePalette } from '../src/ui/theme';

export default function RootLayout() {
  const bootstrap = useAppStore((s) => s.bootstrap);
  const palette = usePalette();
  const scheme = useColorScheme();

  /**
   * The navigator draws its own chrome - header background, tab bar, borders -
   * from the navigation theme, not from `headerStyle`. Left unset it falls back
   * to the built-in light theme, which is invisible in development (the chrome
   * repaints once the colour scheme resolves) and very visible in a static web
   * export, where the prerendered light header ships as-is. Feeding it the same
   * tokens as everything else removes the second source of colour.
   */
  const navigationTheme = useMemo(() => {
    const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: palette.tint,
        background: palette.bg,
        card: palette.bar,
        text: palette.ink,
        border: palette.sep,
        notification: palette.red,
      },
    };
  }, [scheme, palette]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  return (
    <ThemeProvider value={navigationTheme}>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: palette.bar },
          headerTitleStyle: { color: palette.ink, fontSize: 17, fontWeight: '600' },
          headerTintColor: palette.tint,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: palette.bg },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="order/[id]/index"
          options={{ title: 'Order Details', headerBackTitle: 'Orders' }}
        />
        <Stack.Screen
          name="order/[id]/status"
          options={{ title: 'Update Order Status', presentation: 'modal' }}
        />
      </Stack>
    </ThemeProvider>
  );
}
