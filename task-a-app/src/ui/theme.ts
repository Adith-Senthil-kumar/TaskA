import { useColorScheme } from 'react-native';

/**
 * Design tokens, ported from the "Calm by default" prototype.
 *
 * The palette is Apple's system colour set, and the assignment of hue to
 * meaning is the design's argument rather than decoration:
 *
 *   grey   offline - a fact, not an error
 *   orange the phone still owes the server something
 *   red    the server refused; the only state that may need action
 *   purple a conflict, which is rare by design
 *   green  used exactly twice: shift progress, and all-caught-up
 *
 * Synced work carries no badge at all. Absence is the "done" state, which is
 * what keeps the route list readable at arm's length.
 */

export interface Palette {
  bg: string; card: string; fill: string; fill2: string; sep: string;
  ink: string; ink2: string; ink3: string;
  tint: string; tintsoft: string;
  or: string; orsoft: string;
  red: string; redsoft: string;
  grn: string; grnsoft: string;
  pur: string; pursoft: string;
  ind: string; indsoft: string;
  gray: string; bar: string; scrim: string;
}

const light: Palette = {
  bg: '#F2F2F7',
  card: '#FFFFFF',
  fill: '#F2F2F7',
  fill2: '#E9E9EE',
  sep: 'rgba(60,60,67,0.14)',
  ink: '#0B0B0C',
  ink2: 'rgba(60,60,67,0.60)',
  ink3: 'rgba(60,60,67,0.34)',
  tint: '#007AFF',
  tintsoft: 'rgba(0,122,255,0.10)',
  or: '#E8850C',
  orsoft: 'rgba(255,149,0,0.12)',
  red: '#FF3B30',
  redsoft: 'rgba(255,59,48,0.10)',
  grn: '#34C759',
  grnsoft: 'rgba(52,199,89,0.13)',
  pur: '#AF52DE',
  pursoft: 'rgba(175,82,222,0.11)',
  ind: '#5856D6',
  indsoft: 'rgba(88,86,214,0.10)',
  gray: '#8E8E93',
  bar: '#FFFFFF',
  scrim: 'rgba(0,0,0,0.35)',
};

const dark: Palette = {
  bg: '#000000',
  card: '#1C1C1E',
  fill: '#2C2C2E',
  fill2: '#3A3A3C',
  sep: 'rgba(84,84,88,0.62)',
  ink: '#FFFFFF',
  ink2: 'rgba(235,235,245,0.62)',
  ink3: 'rgba(235,235,245,0.32)',
  tint: '#0A84FF',
  tintsoft: 'rgba(10,132,255,0.16)',
  or: '#FF9F0A',
  orsoft: 'rgba(255,159,10,0.16)',
  red: '#FF453A',
  redsoft: 'rgba(255,69,58,0.16)',
  grn: '#30D158',
  grnsoft: 'rgba(48,209,88,0.16)',
  pur: '#BF5AF2',
  pursoft: 'rgba(191,90,242,0.16)',
  ind: '#5E5CE6',
  indsoft: 'rgba(94,92,230,0.16)',
  gray: '#8E8E93',
  bar: '#161618',
  scrim: 'rgba(0,0,0,0.55)',
};



/**
 * The prototype uses translucent iOS bars. Those are rendered here as opaque
 * `bar` colours rather than pulling in expo-blur: the blur only reads correctly
 * on iOS, and a cross-platform app that looks right on one platform and
 * approximate on the other is worse than one that looks deliberate on both.
 */
export function usePalette(): Palette {
  return useColorScheme() === 'dark' ? dark : light;
}

export const radius = { chip: 13, card: 14, control: 12, sheet: 20 } as const;
export const space = (n: number) => n * 4;

/** Tap targets. 48 exceeds the 44pt guidance because this is used with gloves. */
export const HIT = 48;
