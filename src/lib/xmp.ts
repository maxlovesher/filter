import type { DeepPartial } from './defaults';
import { HSL_COLORS, type CurvePoint, type Settings } from './types';

/** Reads a Lightroom / Camera Raw preset (.xmp) into a settings patch. */
export interface XmpPreset {
  name: string;
  patch: DeepPartial<Settings>;
}

const XMP_COLOR: Record<(typeof HSL_COLORS)[number], string> = {
  red: 'Red', orange: 'Orange', yellow: 'Yellow', green: 'Green',
  aqua: 'Aqua', blue: 'Blue', purple: 'Purple', magenta: 'Magenta',
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function parseXmp(text: string, fallbackName: string): XmpPreset {
  const attrs = new Map<string, string>();
  for (const m of text.matchAll(/crs:(\w+)\s*=\s*"([^"]*)"/g)) attrs.set(m[1], m[2]);
  for (const m of text.matchAll(/<crs:(\w+)>([^<]*)<\/crs:\1>/g)) attrs.set(m[1], m[2]);

  const num = (...keys: string[]): number | undefined => {
    for (const k of keys) {
      const raw = attrs.get(k);
      if (raw == null) continue;
      const n = parseFloat(raw);
      if (Number.isFinite(n)) return n;
    }
    return undefined;
  };
  const curve = (key: string): CurvePoint[] | undefined => {
    const m = text.match(new RegExp(`<crs:${key}>\\s*<rdf:Seq>([\\s\\S]*?)</rdf:Seq>`));
    if (!m) return undefined;
    const pts = [...m[1].matchAll(/<rdf:li>\s*([\d.]+)\s*,\s*([\d.]+)\s*<\/rdf:li>/g)].map(
      (x) => [Number(x[1]), Number(x[2])] as CurvePoint,
    );
    return pts.length >= 2 ? pts : undefined;
  };

  const p: Record<string, any> = {};
  const put = (obj: Record<string, any>, key: string, v: number | undefined) => {
    if (v !== undefined) obj[key] = v;
  };

  put(p, 'exposure', num('Exposure2012', 'Exposure'));
  put(p, 'contrast', num('Contrast2012', 'Contrast'));
  put(p, 'highlights', num('Highlights2012', 'HighlightRecovery'));
  put(p, 'shadows', num('Shadows2012', 'Shadows'));
  put(p, 'whites', num('Whites2012'));
  put(p, 'blacks', num('Blacks2012'));

  // JPEG-style presets store relative white balance; raw presets store Kelvin — approximate those.
  const incTemp = num('IncrementalTemperature');
  const kelvin = num('Temperature');
  put(p, 'temp', incTemp ?? (kelvin !== undefined ? clamp(Math.round((kelvin - 5500) / 40), -100, 100) : undefined));
  const incTint = num('IncrementalTint');
  const rawTint = num('Tint');
  put(p, 'tint', incTint ?? (rawTint !== undefined ? clamp(Math.round(rawTint / 1.5), -100, 100) : undefined));

  put(p, 'vibrance', num('Vibrance'));
  put(p, 'saturation', num('Saturation'));
  put(p, 'texture', num('Texture'));
  put(p, 'clarity', num('Clarity2012', 'Clarity'));
  put(p, 'dehaze', num('Dehaze'));

  const vignette: Record<string, number> = {};
  put(vignette, 'amount', num('PostCropVignetteAmount'));
  put(vignette, 'midpoint', num('PostCropVignetteMidpoint'));
  put(vignette, 'roundness', num('PostCropVignetteRoundness'));
  put(vignette, 'feather', num('PostCropVignetteFeather'));
  if (Object.keys(vignette).length) p.vignette = vignette;

  const grain: Record<string, number> = {};
  put(grain, 'amount', num('GrainAmount'));
  put(grain, 'size', num('GrainSize'));
  put(grain, 'roughness', num('GrainFrequency'));
  if (Object.keys(grain).length) p.grain = grain;

  const hsl: Record<string, Record<string, number>> = {};
  for (const c of HSL_COLORS) {
    const entry: Record<string, number> = {};
    put(entry, 'hue', num(`HueAdjustment${XMP_COLOR[c]}`));
    put(entry, 'sat', num(`SaturationAdjustment${XMP_COLOR[c]}`));
    put(entry, 'lum', num(`LuminanceAdjustment${XMP_COLOR[c]}`));
    if (Object.keys(entry).length) hsl[c] = entry;
  }
  if (Object.keys(hsl).length) p.hsl = hsl;

  const grading: Record<string, any> = {};
  const zone = (name: string, hue: number | undefined, sat: number | undefined, lum: number | undefined) => {
    const z: Record<string, number> = {};
    put(z, 'hue', hue);
    put(z, 'sat', sat);
    put(z, 'lum', lum);
    if (Object.keys(z).length) grading[name] = z;
  };
  zone('shadows', num('SplitToningShadowHue', 'ColorGradeShadowHue'), num('SplitToningShadowSaturation', 'ColorGradeShadowSat'), num('ColorGradeShadowLum'));
  zone('midtones', num('ColorGradeMidtoneHue'), num('ColorGradeMidtoneSat'), num('ColorGradeMidtoneLum'));
  zone('highlights', num('SplitToningHighlightHue', 'ColorGradeHighlightHue'), num('SplitToningHighlightSaturation', 'ColorGradeHighlightSat'), num('ColorGradeHighlightLum'));
  zone('global', num('ColorGradeGlobalHue'), num('ColorGradeGlobalSat'), num('ColorGradeGlobalLum'));
  put(grading, 'blending', num('ColorGradeBlending'));
  put(grading, 'balance', num('SplitToningBalance', 'ColorGradeBalance'));
  if (Object.keys(grading).length) p.grading = grading;

  const curves: Record<string, CurvePoint[]> = {};
  const master = curve('ToneCurvePV2012');
  const red = curve('ToneCurvePV2012Red');
  const green = curve('ToneCurvePV2012Green');
  const blue = curve('ToneCurvePV2012Blue');
  if (master) curves.master = master;
  if (red) curves.red = red;
  if (green) curves.green = green;
  if (blue) curves.blue = blue;
  if (Object.keys(curves).length) p.curve = curves;

  const nameMatch =
    text.match(/<crs:Name>[\s\S]*?<rdf:li[^>]*>([^<]+)<\/rdf:li>/) ?? text.match(/crs:Name="([^"]+)"/);
  const name = nameMatch?.[1]?.trim() || fallbackName;

  return { name, patch: p as DeepPartial<Settings> };
}
