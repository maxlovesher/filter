import type { Settings } from '../lib/types';
import { Renderer } from './renderer';

let shared: Renderer | null = null;

/** The shared small renderer (also used for template previews). */
export function thumbRenderer(): Renderer {
  shared ??= new Renderer();
  return shared;
}

/** Renders a graded thumbnail into a 2D canvas using one shared WebGL context. */
export function drawThumb(target: HTMLCanvasElement, bitmap: ImageBitmap, settings: Settings): void {
  shared ??= new Renderer();
  shared.setImage(bitmap);
  shared.render(settings);
  if (target.width !== bitmap.width || target.height !== bitmap.height) {
    target.width = bitmap.width;
    target.height = bitmap.height;
  }
  target.getContext('2d')?.drawImage(shared.canvas, 0, 0);
}
