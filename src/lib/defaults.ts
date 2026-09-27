import { identityCurve, sanitizeCurve } from './curve';
import { CURVE_CHANNELS, HSL_COLORS, type HslAdjust, type HslColor, type Settings, type Template } from './types';

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends (infer U)[] ? U[] : T[K] extends object ? DeepPartial<T[K]> : T[K];
};

const zone = () => ({ hue: 0, sat: 0, lum: 0 });

export function defaultSettings(): Settings {
  const hsl = {} as Record<HslColor, HslAdjust>;
  for (const c of HSL_COLORS) hsl[c] = { hue: 0, sat: 0, lum: 0 };
  return {
    exposure: 0,
    contrast: 0,
    highlights: 0,
    shadows: 0,
    whites: 0,
    blacks: 0,
    temp: 0,
    tint: 0,
    vibrance: 0,
    saturation: 0,
    texture: 0,
    clarity: 0,
    dehaze: 0,
    vignette: { amount: 0, midpoint: 50, roundness: 0, feather: 50 },
    grain: { amount: 0, size: 25, roughness: 50 },
    curve: { master: identityCurve(), red: identityCurve(), green: identityCurve(), blue: identityCurve() },
    hsl,
    grading: { shadows: zone(), midtones: zone(), highlights: zone(), global: zone(), blending: 50, balance: 0 },
    lut: { id: null, amount: 100 },
  };
}

const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Merges only keys that exist in the target with matching types, so imported files can't inject junk. */
function deepMerge(target: Record<string, unknown>, patch: unknown): void {
  if (!patch || typeof patch !== 'object') return;
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (BLOCKED_KEYS.has(k) || !Object.hasOwn(target, k) || v === undefined) continue;
    const cur = target[k];
    if (Array.isArray(cur)) {
      if (Array.isArray(v)) target[k] = structuredClone(v);
    } else if (cur && typeof cur === 'object') {
      deepMerge(cur as Record<string, unknown>, v);
    } else if (typeof cur === 'number') {
      if (typeof v === 'number' && Number.isFinite(v)) target[k] = v;
    } else if (cur === null || typeof cur === 'string') {
      // nullable string ids (e.g. lut.id)
      if (v === null || (typeof v === 'string' && v.length <= 64)) target[k] = v;
    }
  }
}

export function mergeSettings(base: Settings, patch: DeepPartial<Settings> | unknown): Settings {
  const out = structuredClone(base);
  deepMerge(out as unknown as Record<string, unknown>, patch);
  for (const ch of CURVE_CHANNELS) out.curve[ch] = sanitizeCurve(out.curve[ch]) ?? identityCurve();
  return out;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Template strength: moves every adjustment toward (k < 1) or past (k > 1) its neutral value.
 * Shape parameters (vignette midpoint, grain size, grading hue…) are kept as-is.
 */
export function scaleSettings(s: Settings, k: number): Settings {
  const d = defaultSettings();
  const lerp = (v: number, base: number, lo = -100, hi = 100) => clamp(base + (v - base) * k, lo, hi);
  const out = structuredClone(s);
  out.exposure = Math.round(lerp(s.exposure, 0, -5, 5) * 100) / 100;
  for (const key of ['contrast', 'highlights', 'shadows', 'whites', 'blacks', 'temp', 'tint', 'vibrance', 'saturation', 'texture', 'clarity', 'dehaze'] as const) {
    out[key] = Math.round(lerp(s[key], d[key]));
  }
  out.vignette.amount = Math.round(lerp(s.vignette.amount, 0));
  out.grain.amount = Math.round(lerp(s.grain.amount, 0, 0, 100));
  for (const c of HSL_COLORS) {
    out.hsl[c] = { hue: Math.round(lerp(s.hsl[c].hue, 0)), sat: Math.round(lerp(s.hsl[c].sat, 0)), lum: Math.round(lerp(s.hsl[c].lum, 0)) };
  }
  for (const z of ['shadows', 'midtones', 'highlights', 'global'] as const) {
    out.grading[z] = { hue: s.grading[z].hue, sat: Math.round(lerp(s.grading[z].sat, 0, 0, 100)), lum: Math.round(lerp(s.grading[z].lum, 0)) };
  }
  out.grading.balance = Math.round(lerp(s.grading.balance, 0));
  for (const ch of CURVE_CHANNELS) {
    out.curve[ch] = s.curve[ch].map(([x, y]) => [x, Math.round(clamp(x + (y - x) * k, 0, 255))]);
  }
  out.lut.amount = Math.round(lerp(s.lut.amount, 0, 0, 100));
  return out;
}

const builtin = (id: string, name: string, note: string, patch: DeepPartial<Settings>): Template => ({
  id: `builtin-${id}`,
  name,
  note,
  builtin: true,
  settings: mergeSettings(defaultSettings(), patch),
});

export const BUILTIN_TEMPLATES: Template[] = [
  builtin('foggy-night', 'Foggy Night', 'From your reel — purple haze, lifted blacks, heavy grain', {
    exposure: 0.6,
    contrast: -30,
    highlights: -54,
    shadows: 34,
    whites: 13,
    blacks: 78,
    temp: -8,
    tint: 5,
    vibrance: 46,
    saturation: 49,
    clarity: -57,
    dehaze: -22,
    grain: { amount: 72 },
    curve: {
      master: [
        [0, 49],
        [69, 60],
        [111, 87],
        [182, 158],
        [219, 209],
        [255, 234],
      ],
    },
    hsl: {
      red: { hue: 5, sat: -9, lum: 0 },
      orange: { hue: 13, sat: -13, lum: 0 },
      yellow: { hue: -8, sat: 5, lum: 0 },
      green: { hue: 10, sat: -60, lum: -20 },
      aqua: { hue: 60, sat: -45, lum: -10 },
      blue: { hue: 10, sat: 20, lum: -10 },
      purple: { hue: 0, sat: 15, lum: 0 },
      magenta: { hue: -10, sat: 15, lum: 5 },
    },
    grading: {
      shadows: { hue: 232, sat: 24, lum: 0 },
      midtones: { hue: 292, sat: 12, lum: 0 },
      highlights: { hue: 286, sat: 19, lum: 0 },
    },
  }),
  builtin('oppenheimer', 'Oppenheimer', 'Warm, contrasty, muted — teal shadows, amber highlights', {
    exposure: -0.1,
    contrast: 25,
    highlights: -35,
    shadows: -5,
    whites: 10,
    blacks: -15,
    temp: 14,
    tint: 2,
    vibrance: -10,
    saturation: -18,
    clarity: 12,
    dehaze: 6,
    vignette: { amount: -22 },
    grain: { amount: 30, size: 30 },
    curve: {
      master: [
        [0, 14],
        [64, 52],
        [192, 205],
        [255, 246],
      ],
    },
    hsl: {
      red: { hue: 5, sat: -10 },
      orange: { hue: 4, sat: 8, lum: 4 },
      yellow: { hue: -15, sat: -25, lum: -5 },
      green: { hue: 25, sat: -65, lum: -20 },
      aqua: { hue: 10, sat: -25, lum: -10 },
      blue: { hue: -10, sat: -35, lum: -20 },
      purple: { sat: -40 },
      magenta: { sat: -40 },
    },
    grading: { shadows: { hue: 195, sat: 16 }, highlights: { hue: 38, sat: 22 }, balance: -10 },
  }),
  builtin('barbie', 'Barbie', 'Bright, pink-tinted, soft and punchy', {
    exposure: 0.3,
    contrast: -8,
    highlights: -25,
    shadows: 25,
    whites: 12,
    blacks: 10,
    temp: 4,
    tint: 16,
    vibrance: 28,
    saturation: 8,
    clarity: -12,
    curve: {
      master: [
        [0, 18],
        [128, 140],
        [255, 252],
      ],
    },
    hsl: {
      red: { hue: -25, sat: 20, lum: 5 },
      orange: { hue: -8, sat: -5, lum: 12 },
      yellow: { hue: -10, sat: -20, lum: 10 },
      green: { hue: 30, sat: -20, lum: 10 },
      aqua: { hue: 10, sat: 15, lum: 15 },
      blue: { hue: -35, sat: 10, lum: 15 },
      purple: { hue: 40, sat: 20, lum: 10 },
      magenta: { hue: 10, sat: 35, lum: 12 },
    },
    grading: {
      shadows: { hue: 320, sat: 10 },
      midtones: { hue: 335, sat: 8 },
      highlights: { hue: 340, sat: 18 },
      global: { hue: 335, sat: 7 },
      blending: 60,
    },
  }),
  builtin('dreamcore', 'Dreamcore', 'Hazy pastel glow, soft and faded', {
    exposure: 0.35,
    contrast: -38,
    highlights: -30,
    shadows: 40,
    whites: 18,
    blacks: 35,
    temp: -6,
    tint: 14,
    vibrance: 18,
    saturation: -12,
    texture: -25,
    clarity: -60,
    dehaze: -28,
    grain: { amount: 22, size: 35 },
    vignette: { amount: 10, feather: 80 },
    curve: {
      master: [
        [0, 42],
        [90, 100],
        [180, 190],
        [255, 238],
      ],
    },
    hsl: {
      orange: { sat: -10, lum: 10 },
      yellow: { hue: -10, sat: -25, lum: 15 },
      green: { hue: 35, sat: -35, lum: 20 },
      aqua: { hue: 15, sat: -10, lum: 20 },
      blue: { hue: 15, sat: -15, lum: 20 },
      purple: { sat: 10, lum: 15 },
      magenta: { sat: 15, lum: 15 },
    },
    grading: {
      shadows: { hue: 250, sat: 18 },
      midtones: { hue: 300, sat: 6 },
      highlights: { hue: 330, sat: 14 },
      blending: 70,
    },
  }),
  builtin('film', 'Classic Film', 'Faded blacks, warm highlights, fine grain', {
    contrast: 8,
    highlights: -30,
    shadows: 15,
    whites: -8,
    blacks: 12,
    temp: 8,
    tint: 3,
    vibrance: 5,
    saturation: -12,
    clarity: 5,
    grain: { amount: 35, size: 30, roughness: 60 },
    vignette: { amount: -12 },
    curve: {
      master: [
        [0, 26],
        [60, 56],
        [190, 202],
        [255, 242],
      ],
      blue: [
        [0, 20],
        [255, 238],
      ],
    },
    hsl: {
      red: { hue: 8, sat: -8 },
      orange: { hue: 5, sat: 5 },
      yellow: { hue: -12, sat: -20 },
      green: { hue: -15, sat: -30, lum: -10 },
      aqua: { hue: -10, sat: -20 },
      blue: { hue: -15, sat: -25, lum: -10 },
    },
    grading: { shadows: { hue: 190, sat: 10 }, highlights: { hue: 45, sat: 12 } },
  }),
  builtin('moody', 'Moody', 'Dark and muted, deep greens, teal shadows', {
    exposure: -0.35,
    contrast: 18,
    highlights: -45,
    shadows: -15,
    whites: -10,
    blacks: -12,
    temp: -4,
    vibrance: -5,
    saturation: -22,
    clarity: 15,
    dehaze: 8,
    vignette: { amount: -30, feather: 60 },
    grain: { amount: 15 },
    curve: {
      master: [
        [0, 18],
        [70, 55],
        [180, 178],
        [255, 235],
      ],
    },
    hsl: {
      orange: { sat: 5, lum: 5 },
      yellow: { hue: -20, sat: -40, lum: -15 },
      green: { hue: 30, sat: -60, lum: -35 },
      aqua: { sat: -30, lum: -20 },
      blue: { hue: -10, sat: -35, lum: -25 },
    },
    grading: { shadows: { hue: 200, sat: 20 }, highlights: { hue: 40, sat: 12 }, balance: -20 },
  }),
  builtin('bw', 'B&W Film', 'Contrasty black & white with grain', {
    contrast: 30,
    highlights: -20,
    shadows: 15,
    whites: 15,
    blacks: -20,
    saturation: -100,
    clarity: 15,
    grain: { amount: 40, size: 30, roughness: 60 },
    vignette: { amount: -15 },
    curve: {
      master: [
        [0, 12],
        [64, 50],
        [192, 210],
        [255, 250],
      ],
    },
  }),
];
