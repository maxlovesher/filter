import { Zip, ZipPassThrough } from 'fflate';
import { decodeImage, downloadBlob, slug, stem } from '../lib/files';
import type { Photo } from '../lib/types';
import { Renderer } from './renderer';

export interface ExportFormat {
  format: 'jpeg' | 'png';
  quality: number; // 60..100, JPEG only
  /** Longest side in px; null keeps the original size. */
  maxEdge: number | null;
}

export interface ExportRun {
  /** Where to write; null downloads a single file or a ZIP. */
  dir: FileSystemDirectoryHandle | null;
  signal: AbortSignal;
  /** `done` can be fractional while a video is encoding. */
  onProgress: (done: number, total: number, label: string) => void;
}

export class ExportCanceled extends Error {
  constructor() {
    super('Export canceled');
  }
}

/**
 * Renders every item at full resolution with its own settings. Photos become JPG/PNG, videos MP4.
 * Returns the number of files written.
 */
export async function exportItems(items: Photo[], fmt: ExportFormat, run: ExportRun): Promise<number> {
  const { dir, signal, onProgress } = run;
  const imageMime = fmt.format === 'png' ? 'image/png' : 'image/jpeg';
  const imageExt = fmt.format === 'png' ? 'png' : 'jpg';
  const used = new Set<string>();
  const nameFor = (p: Photo) => {
    const ext = p.kind === 'video' ? 'mp4' : imageExt;
    const base = `${stem(p.name)}-${slug(p.templateName ?? 'edit')}`;
    let n = `${base}.${ext}`;
    for (let i = 2; used.has(n.toLowerCase()); i++) n = `${base}-${i}.${ext}`;
    used.add(n.toLowerCase());
    return n;
  };

  const chunks: BlobPart[] = [];
  let zipError: Error | null = null;
  const zip =
    !dir && items.length > 1
      ? new Zip((err, chunk) => {
          if (err) zipError = err;
          else chunks.push(chunk as BlobPart);
        })
      : null;

  const renderer = new Renderer();
  let single: { blob: Blob; name: string } | null = null;
  try {
    for (let i = 0; i < items.length; i++) {
      if (signal.aborted) throw new ExportCanceled();
      const p = items[i];
      onProgress(i, items.length, p.name);

      let blob: Blob;
      if (p.kind === 'video') {
        // the MP4 encoder is big, so it's only loaded when a video is actually exported
        const { exportVideo } = await import('./video');
        blob = await exportVideo(p.file, p.settings, renderer, (f) => onProgress(i + f, items.length, p.name), signal, fmt.maxEdge ?? undefined, p.trim ?? null);
      } else {
        const bmp = await decodeImage(p.file, Math.min(fmt.maxEdge ?? Infinity, renderer.maxSize));
        renderer.setImage(bmp);
        renderer.render(p.settings);
        bmp.close();
        blob = await renderer.toBlob(imageMime, fmt.quality / 100);
      }
      if (signal.aborted) throw new ExportCanceled();

      const name = nameFor(p);
      if (dir) {
        const fh = await dir.getFileHandle(name, { create: true });
        const w = await fh.createWritable();
        await w.write(blob);
        await w.close();
      } else if (zip) {
        const entry = new ZipPassThrough(name);
        zip.add(entry);
        entry.push(new Uint8Array(await blob.arrayBuffer()), true);
        if (zipError) throw zipError;
      } else {
        single = { blob, name };
      }
      onProgress(i + 1, items.length, p.name);
    }

    if (zip) {
      zip.end();
      if (zipError) throw zipError;
      downloadBlob(new Blob(chunks, { type: 'application/zip' }), `fiilter-${items.length}-files.zip`);
    } else if (single) {
      downloadBlob(single.blob, single.name);
    }
    return items.length;
  } catch (e) {
    if (signal.aborted) throw new ExportCanceled();
    throw e;
  } finally {
    renderer.dispose();
  }
}
