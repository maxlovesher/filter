import { ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Mp4OutputFormat, Output, QUALITY_HIGH, VideoSample } from 'mediabunny';
import type { Settings } from '../lib/types';
import { Renderer } from './renderer';

/** Largest long edge we encode; 4K keeps encoders and memory happy. */
const MAX_VIDEO_EDGE = 3840;

const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);

/**
 * Grades every frame of a video with the same engine used for photos and re-encodes it to MP4.
 * Audio is copied over untouched when possible (re-encoded only if MP4 can't hold it).
 */
export async function exportVideo(
  file: File,
  settings: Settings,
  renderer: Renderer,
  onProgress: (p: number) => void,
  signal: AbortSignal,
  maxEdge = MAX_VIDEO_EDGE,
  trim: { start: number; end: number } | null = null,
): Promise<Blob> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error(`${file.name} has no video track`);

    const longEdge = Math.max(track.displayWidth, track.displayHeight);
    const scale = Math.min(1, Math.min(maxEdge, MAX_VIDEO_EDGE, renderer.maxSize) / longEdge);
    const w = even(track.displayWidth * scale);
    const h = even(track.displayHeight * scale);

    const work = document.createElement('canvas');
    work.width = w;
    work.height = h;
    const ctx = work.getContext('2d', { alpha: false })!;

    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
    const conversion = await Conversion.init({
      input,
      output,
      showWarnings: false,
      trim: trim ? { start: trim.start, end: trim.end } : undefined,
      video: {
        quality: QUALITY_HIGH,
        forceTranscode: true,
        allowTransformationMetadata: false,
        processedWidth: w,
        processedHeight: h,
        process: (sample) => {
          // draw() applies any rotation/flip, so phone videos come out upright
          sample.draw(ctx, 0, 0, w, h);
          renderer.setImage(work);
          renderer.render(settings, w, h);
          return new VideoSample(renderer.canvas, { timestamp: sample.timestamp, duration: sample.duration });
        },
      },
    });
    if (!conversion.isValid) {
      const reasons = conversion.discardedTracks.map((d) => d.reason).join(', ');
      throw new Error(`This browser can't convert ${file.name}${reasons ? ` (${reasons})` : ''}`);
    }
    conversion.onProgress = (p) => onProgress(p);
    const abort = () => void conversion.cancel();
    signal.addEventListener('abort', abort, { once: true });
    try {
      await conversion.execute();
    } finally {
      signal.removeEventListener('abort', abort);
    }
    const buffer = output.target.buffer;
    if (!buffer) throw new Error('Video encoding produced no data');
    return new Blob([buffer], { type: 'video/mp4' });
  } finally {
    input.dispose();
  }
}
