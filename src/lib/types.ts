export const HSL_COLORS = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'] as const;
export type HslColor = (typeof HSL_COLORS)[number];

export const GRADE_ZONES = ['shadows', 'midtones', 'highlights', 'global'] as const;
export type GradeZoneName = (typeof GRADE_ZONES)[number];

export const CURVE_CHANNELS = ['master', 'red', 'green', 'blue'] as const;
export type CurveChannel = (typeof CURVE_CHANNELS)[number];

/** [input, output], both 0–255 like Lightroom's point curve. */
export type CurvePoint = [number, number];

export interface HslAdjust {
  hue: number; // -100..100
  sat: number; // -100..100
  lum: number; // -100..100
}

export interface GradeZone {
  hue: number; // 0..360
  sat: number; // 0..100
  lum: number; // -100..100
}

/** Every value uses Lightroom's own scale, so numbers from a recipe can be typed in as-is. */
export interface Settings {
  exposure: number; // -5..5
  contrast: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  temp: number;
  tint: number;
  vibrance: number;
  saturation: number;
  texture: number;
  clarity: number;
  dehaze: number;
  vignette: { amount: number; midpoint: number; roundness: number; feather: number };
  grain: { amount: number; size: number; roughness: number };
  curve: Record<CurveChannel, CurvePoint[]>;
  hsl: Record<HslColor, HslAdjust>;
  grading: Record<GradeZoneName, GradeZone> & { blending: number; balance: number };
  /** Optional creative 3D LUT (.cube), applied after color grading. */
  lut: { id: string | null; amount: number };
}

export interface Template {
  id: string;
  name: string;
  settings: Settings;
  builtin?: boolean;
  note?: string;
}

/** The look on one photo/video: its settings plus which template it came from. */
export interface Look {
  settings: Settings;
  templateId: string | null;
  templateName: string | null;
  /** Template strength in percent (100 = as saved). */
  amount: number;
  edited: boolean;
}

export type MediaKind = 'image' | 'video';

export interface Photo extends Look {
  id: string;
  kind: MediaKind;
  file: File;
  name: string;
  thumb: ImageBitmap | null;
  /** Seconds, for videos. */
  duration?: number;
  /** Optional in/out points (seconds) for video export. */
  trim?: { start: number; end: number } | null;
}
