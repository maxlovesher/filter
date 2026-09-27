import { mergeSettings } from '../lib/defaults';
import { writeCube } from '../lib/luts';
import type { Settings } from '../lib/types';
import { Renderer } from './renderer';

/**
 * Bakes the color part of a look into a .cube LUT by rendering an identity "LUT image"
 * (every RGB combination on a grid) through the engine. Spatial effects — texture, clarity,
 * dehaze, vignette, grain — can't be expressed as a LUT, so they're switched off.
 */
export function bakeCube(settings: Settings, title: string, size = 33): string {
  const w = size * size;
  const h = size;
  const src = document.createElement('canvas');
  src.width = w;
  src.height = h;
  const ctx = src.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  const step = 255 / (size - 1);
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const i = (g * w + b * size + r) * 4;
        img.data[i] = Math.round(r * step);
        img.data[i + 1] = Math.round(g * step);
        img.data[i + 2] = Math.round(b * step);
        img.data[i + 3] = 255;
      }
    }
  }
  ctx.putImageData(img, 0, 0);

  const colorOnly = mergeSettings(settings, { texture: 0, clarity: 0, dehaze: 0, vignette: { amount: 0 }, grain: { amount: 0 } });
  const renderer = new Renderer();
  try {
    renderer.setImage(src);
    renderer.render(colorOnly);
    const px = renderer.readPixels();
    const rgb = new Uint8Array(size ** 3 * 3);
    for (let b = 0; b < size; b++) {
      for (let g = 0; g < size; g++) {
        for (let r = 0; r < size; r++) {
          const i = (g * w + b * size + r) * 4;
          const o = ((b * size + g) * size + r) * 3;
          rgb[o] = px[i];
          rgb[o + 1] = px[i + 1];
          rgb[o + 2] = px[i + 2];
        }
      }
    }
    return writeCube(title, size, rgb);
  } finally {
    renderer.dispose();
  }
}
