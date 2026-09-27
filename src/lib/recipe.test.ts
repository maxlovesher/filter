import { describe, expect, it } from 'vitest';
import { parseRecipe } from './recipe';

describe('parseRecipe', () => {
  it('reads the Foggy Night reel recipe', () => {
    const { patch } = parseRecipe(`
      Exposure + 0.60   Contrast – 30   Highlights – 54   Shadows + 34   Whites + 13   Blacks + 78
      Temp – 8  Tint + 5  Vibrance + 46  Saturation + 49
      Texture 0  Clarity – 57  Dehaze – 22  Vignette 0  Grain 72
      Red: Hue +5 Saturation -9 Luminance 0
      Orange: Hue +13 Saturation -13 Luminance 0
      Purple: Hue 0 Saturation +15 Luminance 0
      Color grading
      Shadows: Hue 225 Sat 12
      Highlights: Hue 286 Sat 19
      Blending 50 Balance -10
      Tone curve (0,49) (69,60) (111,87) (182,158) (219,209) (255,234)
    `);
    expect(patch).toMatchObject({
      exposure: 0.6, contrast: -30, highlights: -54, shadows: 34, whites: 13, blacks: 78,
      temp: -8, tint: 5, vibrance: 46, saturation: 49,
      texture: 0, clarity: -57, dehaze: -22,
      vignette: { amount: 0 },
      grain: { amount: 72 },
      hsl: {
        red: { hue: 5, sat: -9, lum: 0 },
        orange: { hue: 13, sat: -13, lum: 0 },
        purple: { hue: 0, sat: 15, lum: 0 },
      },
      grading: {
        shadows: { hue: 225, sat: 12 },
        highlights: { hue: 286, sat: 19 },
        blending: 50,
        balance: -10,
      },
    });
    expect(patch.curve?.master).toEqual([[0, 49], [69, 60], [111, 87], [182, 158], [219, 209], [255, 234]]);
  });

  it('keeps basic Highlights/Shadows sliders separate from grading wheels', () => {
    const { patch } = parseRecipe('Highlights -40 Shadows +20 Midtones Hue 30 Sat 8');
    expect(patch.highlights).toBe(-40);
    expect(patch.shadows).toBe(20);
    expect(patch.grading?.midtones).toEqual({ hue: 30, sat: 8 });
  });

  it('sends Saturation back to the basic slider after a basic key resets context', () => {
    const { patch } = parseRecipe('Blue Sat -20 Temp +10 Saturation -5');
    expect(patch.hsl?.blue?.sat).toBe(-20);
    expect(patch.saturation).toBe(-5);
  });

  it('parses per-channel curves and grain details', () => {
    const { patch } = parseRecipe('Curve Blue (0,20) (255,235)  Grain 30 Size 40 Roughness 60');
    expect(patch.curve?.blue).toEqual([[0, 20], [255, 235]]);
    expect(patch.grain).toEqual({ amount: 30, size: 40, roughness: 60 });
  });

  it('clamps out-of-range values', () => {
    const { patch } = parseRecipe('Exposure 9 Contrast -250');
    expect(patch.exposure).toBe(5);
    expect(patch.contrast).toBe(-100);
  });
});
