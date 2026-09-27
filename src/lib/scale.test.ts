import { describe, expect, it } from 'vitest';
import { BUILTIN_TEMPLATES, defaultSettings, mergeSettings, scaleSettings } from './defaults';

const foggy = BUILTIN_TEMPLATES.find((t) => t.id === 'builtin-foggy-night')!.settings;

describe('scaleSettings (template strength)', () => {
  it('100% is unchanged', () => {
    expect(scaleSettings(foggy, 1)).toEqual(foggy);
  });

  it('0% is neutral except shape parameters', () => {
    const z = scaleSettings(foggy, 0);
    const d = defaultSettings();
    expect(z.exposure).toBe(0);
    expect(z.blacks).toBe(0);
    expect(z.grain.amount).toBe(0);
    expect(z.hsl.orange).toEqual({ hue: 0, sat: 0, lum: 0 });
    expect(z.grading.highlights.sat).toBe(0);
    expect(z.grading.highlights.hue).toBe(286); // hue is kept, only strength changes
    expect(z.curve.master.every(([x, y]) => x === y)).toBe(true);
    expect(z.vignette.midpoint).toBe(d.vignette.midpoint);
  });

  it('50% halves adjustments and curve offsets', () => {
    const h = scaleSettings(foggy, 0.5);
    expect(h.exposure).toBe(0.3);
    expect(h.contrast).toBe(-15);
    expect(h.curve.master[0]).toEqual([0, 25]); // 0→49 becomes 0→24.5 → 25
  });

  it('clamps when exaggerating', () => {
    const big = scaleSettings(foggy, 2);
    expect(big.blacks).toBe(100);
    expect(big.grain.amount).toBe(100);
  });

  it('merge keeps lut id strings and rejects junk', () => {
    const s = mergeSettings(defaultSettings(), { lut: { id: 'lut-00ff00ff', amount: 60 } });
    expect(s.lut).toEqual({ id: 'lut-00ff00ff', amount: 60 });
    const bad = mergeSettings(defaultSettings(), { lut: { id: 42 }, exposure: 'loud' } as unknown);
    expect(bad.lut.id).toBeNull();
    expect(bad.exposure).toBe(0);
  });
});
