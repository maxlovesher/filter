import { describe, expect, it } from 'vitest';
import { buildCurveLut, identityCurve, makeSpline, sanitizeCurve } from './curve';

describe('curve', () => {
  it('identity spline is a straight line', () => {
    const f = makeSpline(identityCurve());
    for (const x of [0, 17, 128, 200, 255]) expect(f(x)).toBeCloseTo(x, 5);
  });

  it('passes through every point and stays monotone', () => {
    const pts: [number, number][] = [[0, 49], [69, 60], [111, 87], [182, 158], [219, 209], [255, 234]];
    const f = makeSpline(pts);
    for (const [x, y] of pts) expect(f(x)).toBeCloseTo(y, 5);
    let prev = -1;
    for (let x = 0; x <= 255; x++) {
      expect(f(x)).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = f(x);
    }
  });

  it('builds an identity LUT for identity curves', () => {
    const c = { master: identityCurve(), red: identityCurve(), green: identityCurve(), blue: identityCurve() };
    const lut = buildCurveLut(c);
    expect(lut[0]).toBe(0);
    expect(lut[(lut.length / 4 - 1) * 4]).toBe(255);
  });

  it('sanitizes junk input', () => {
    expect(sanitizeCurve('nope')).toBeNull();
    expect(sanitizeCurve([[0, 0]])).toBeNull();
    expect(sanitizeCurve([[300, -5], [10, 20], ['x', 1], [10, 30]])).toEqual([[10, 30], [255, 0]]);
  });
});
