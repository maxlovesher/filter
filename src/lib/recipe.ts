import type { DeepPartial } from './defaults';
import type { CurveChannel, CurvePoint, GradeZoneName, HslColor, Settings } from './types';

/**
 * Turns a Lightroom recipe typed or pasted as text into a settings patch, e.g.
 *   "Exposure +0.60, Contrast -30 … Orange: Hue +13 Sat -13 … Color grading Highlights Hue 286 Sat 19
 *    Tone curve (0,49) (69,60) (255,234)"
 */
export interface ParsedRecipe {
  patch: DeepPartial<Settings>;
  found: string[];
}

type Basic =
  | 'exposure' | 'contrast' | 'highlights' | 'shadows' | 'whites' | 'blacks'
  | 'temp' | 'tint' | 'vibrance' | 'saturation' | 'texture' | 'clarity' | 'dehaze';

const BASIC: Record<string, Basic> = {
  exposure: 'exposure', exp: 'exposure', contrast: 'contrast',
  highlights: 'highlights', highlight: 'highlights', shadows: 'shadows', shadow: 'shadows',
  whites: 'whites', white: 'whites', blacks: 'blacks', black: 'blacks',
  temp: 'temp', temperature: 'temp', tint: 'tint', vibrance: 'vibrance',
  saturation: 'saturation', sat: 'saturation', texture: 'texture', clarity: 'clarity', dehaze: 'dehaze',
};

const COLORS: Record<string, HslColor> = {
  red: 'red', reds: 'red', orange: 'orange', oranges: 'orange', yellow: 'yellow', yellows: 'yellow',
  green: 'green', greens: 'green', aqua: 'aqua', aquas: 'aqua', cyan: 'aqua', teal: 'aqua',
  blue: 'blue', blues: 'blue', purple: 'purple', purples: 'purple', violet: 'purple',
  magenta: 'magenta', magentas: 'magenta', pink: 'magenta',
};

const ZONES: Record<string, GradeZoneName> = {
  shadows: 'shadows', shadow: 'shadows', midtones: 'midtones', midtone: 'midtones', mids: 'midtones',
  highlights: 'highlights', highlight: 'highlights', global: 'global',
};

const PROPS: Record<string, 'hue' | 'sat' | 'lum'> = {
  hue: 'hue', saturation: 'sat', sat: 'sat', luminance: 'lum', lum: 'lum', luminosity: 'lum', lightness: 'lum',
};

const CURVE_FILLER = new Set(['point', 'points', 'tone', 'input', 'output', 'in', 'out', 'x', 'y', 'channel']);

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const label = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

function tokenize(text: string): (string | number)[] {
  const norm = text
    .toLowerCase()
    .replace(/[−‒–—]/g, '-') // unicode minus/dashes, as shown in Lightroom
    .replace(/([+-])\s+(?=\d|\.\d)/g, '$1'); // "+ 0.60" → "+0.60"
  const out: (string | number)[] = [];
  for (const m of norm.matchAll(/[a-z]+|[+-]?(?:\d+\.?\d*|\.\d+)/g)) {
    out.push(/[a-z]/.test(m[0]) ? m[0] : parseFloat(m[0]));
  }
  return out;
}

export function parseRecipe(text: string): ParsedRecipe {
  const toks = tokenize(text);
  const patch: Record<string, any> = {};
  const found: string[] = [];

  let color: HslColor | null = null;
  let zone: GradeZoneName | null = null;
  let lastCtx: 'color' | 'zone' | null = null;
  let effect: 'vignette' | 'grain' | null = null;
  let inCurve = false;
  let curveCh: CurveChannel = 'master';
  let curveNums: number[] = [];

  const setBasic = (key: Basic, v: number) => {
    patch[key] = key === 'exposure' ? clamp(v, -5, 5) : clamp(Math.round(v), -100, 100);
    found.push(`${label(key)} ${signed(patch[key])}`);
  };
  const setHsl = (c: HslColor, prop: 'hue' | 'sat' | 'lum', v: number) => {
    patch.hsl ??= {};
    patch.hsl[c] ??= {};
    patch.hsl[c][prop] = clamp(Math.round(v), -100, 100);
    found.push(`${label(c)} ${prop} ${signed(patch.hsl[c][prop])}`);
  };
  const setGrade = (z: GradeZoneName, prop: 'hue' | 'sat' | 'lum', v: number) => {
    patch.grading ??= {};
    patch.grading[z] ??= {};
    const val = prop === 'hue' ? ((Math.round(v) % 360) + 360) % 360 : prop === 'sat' ? clamp(Math.round(v), 0, 100) : clamp(Math.round(v), -100, 100);
    patch.grading[z][prop] = val;
    found.push(`Grading ${z} ${prop} ${prop === 'lum' ? signed(val) : val}`);
  };
  const setEffect = (group: 'vignette' | 'grain', prop: string, v: number) => {
    patch[group] ??= {};
    const lo = (group === 'vignette' && (prop === 'amount' || prop === 'roundness')) ? -100 : 0;
    patch[group][prop] = clamp(Math.round(v), lo, 100);
    found.push(`${label(group)} ${prop} ${patch[group][prop]}`);
  };
  const flushCurve = () => {
    if (curveNums.length >= 4) {
      const pts: CurvePoint[] = [];
      for (let k = 0; k + 1 < curveNums.length; k += 2) {
        pts.push([clamp(Math.round(curveNums[k]), 0, 255), clamp(Math.round(curveNums[k + 1]), 0, 255)]);
      }
      pts.sort((a, b) => a[0] - b[0]);
      patch.curve ??= {};
      patch.curve[curveCh] = pts;
      found.push(`Tone curve ${curveCh === 'master' ? 'RGB' : label(curveCh)}: ${pts.length} points`);
    }
    curveNums = [];
  };

  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i];
    if (typeof tok === 'number') {
      if (inCurve) curveNums.push(tok);
      continue;
    }
    const next = toks[i + 1];
    const hasNum = typeof next === 'number';

    if (tok === 'curve' || tok === 'curves') {
      flushCurve();
      inCurve = true;
      curveCh = 'master';
      continue;
    }
    if (inCurve) {
      if (tok === 'rgb' || tok === 'master' || tok === 'luma') { flushCurve(); curveCh = 'master'; continue; }
      if (tok === 'red' || tok === 'green' || tok === 'blue') { flushCurve(); curveCh = tok; continue; }
      if (CURVE_FILLER.has(tok)) continue;
      flushCurve();
      inCurve = false;
    }

    if (tok === 'vignette' || tok === 'grain') {
      effect = tok;
      if (hasNum) { setEffect(tok, 'amount', next); i++; }
      continue;
    }
    if (hasNum && (tok === 'size' || tok === 'roughness')) { setEffect('grain', tok, next); i++; continue; }
    if (hasNum && (tok === 'midpoint' || tok === 'feather' || tok === 'roundness')) { setEffect('vignette', tok, next); i++; continue; }
    if (hasNum && tok === 'amount' && effect) { setEffect(effect, 'amount', next); i++; continue; }
    if (hasNum && (tok === 'blending' || tok === 'blend' || tok === 'balance')) {
      patch.grading ??= {};
      const key = tok === 'balance' ? 'balance' : 'blending';
      patch.grading[key] = clamp(Math.round(next), key === 'balance' ? -100 : 0, 100);
      found.push(`Grading ${key} ${patch.grading[key]}`);
      i++;
      continue;
    }

    // Context words (no number right after): "Orange:" / "Highlights" (as a color-grading wheel)
    if (!hasNum && tok in COLORS) { color = COLORS[tok]; lastCtx = 'color'; continue; }
    if (!hasNum && tok in ZONES) { zone = ZONES[tok]; lastCtx = 'zone'; continue; }

    if (hasNum && tok in PROPS) {
      const prop = PROPS[tok];
      if (lastCtx === 'zone' && zone) setGrade(zone, prop, next);
      else if (lastCtx === 'color' && color) setHsl(color, prop, next);
      else if (prop === 'sat') setBasic('saturation', next);
      i++;
      continue;
    }

    if (hasNum && tok in BASIC) {
      setBasic(BASIC[tok], next);
      color = null;
      zone = null;
      lastCtx = null;
      i++;
    }
  }
  flushCurve();

  return { patch: patch as DeepPartial<Settings>, found };
}
