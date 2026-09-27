import type { CurveChannel, CurvePoint } from './types';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const identityCurve = (): CurvePoint[] => [
  [0, 0],
  [255, 255],
];

export function isIdentity(points: CurvePoint[]): boolean {
  return points.every(([x, y]) => x === y);
}

/** Cleans up points from imports: finite, 0–255, sorted, unique x. Returns null if unusable. */
export function sanitizeCurve(points: unknown): CurvePoint[] | null {
  if (!Array.isArray(points)) return null;
  const byX = new Map<number, number>();
  for (const p of points) {
    if (!Array.isArray(p) || p.length < 2) continue;
    const [x, y] = p;
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    byX.set(clamp(Math.round(x), 0, 255), clamp(Math.round(y), 0, 255));
  }
  const out = [...byX.entries()].sort((a, b) => a[0] - b[0]) as CurvePoint[];
  return out.length >= 2 ? out : null;
}

/** Monotone cubic (Fritsch–Carlson) through the points; flat beyond the end points. */
export function makeSpline(points: CurvePoint[]): (x: number) => number {
  const pts = [...points].sort((a, b) => a[0] - b[0]);
  const n = pts.length;
  if (n === 0) return (x) => x;
  if (n === 1) return () => pts[0][1];

  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(Math.max(xs[i + 1] - xs[i], 1e-6));
    m.push((ys[i + 1] - ys[i]) / dx[i]);
  }
  const t: number[] = new Array(n);
  t[0] = m[0];
  t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
      continue;
    }
    const a = t[i] / m[i];
    const b = t[i + 1] / m[i];
    const s = a * a + b * b;
    if (s > 9) {
      const tau = 3 / Math.sqrt(s);
      t[i] = tau * a * m[i];
      t[i + 1] = tau * b * m[i];
    }
  }

  return (x: number) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const h = dx[i];
    const u = (x - xs[i]) / h;
    const u2 = u * u;
    const u3 = u2 * u;
    const y =
      (2 * u3 - 3 * u2 + 1) * ys[i] +
      (u3 - 2 * u2 + u) * h * t[i] +
      (-2 * u3 + 3 * u2) * ys[i + 1] +
      (u3 - u2) * h * t[i + 1];
    return clamp(y, 0, 255);
  };
}

export const CURVE_LUT_SIZE = 1024;

/** RGBA lookup table: each channel = channelCurve(masterCurve(x)). */
export function buildCurveLut(curve: Record<CurveChannel, CurvePoint[]>): Uint8Array {
  const master = makeSpline(curve.master);
  const r = makeSpline(curve.red);
  const g = makeSpline(curve.green);
  const b = makeSpline(curve.blue);
  const lut = new Uint8Array(CURVE_LUT_SIZE * 4);
  for (let i = 0; i < CURVE_LUT_SIZE; i++) {
    const v = master((i / (CURVE_LUT_SIZE - 1)) * 255);
    lut[i * 4] = Math.round(r(v));
    lut[i * 4 + 1] = Math.round(g(v));
    lut[i * 4 + 2] = Math.round(b(v));
    lut[i * 4 + 3] = 255;
  }
  return lut;
}
