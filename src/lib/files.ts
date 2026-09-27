export const IMAGE_EXT = /\.(jpe?g|png|webp|avif|gif|bmp|heic|heif)$/i;
export const PRESET_EXT = /\.(xmp|json)$/i;
export const LUT_EXT = /\.cube$/i;
export const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv)$/i;

export const isImageFile = (f: File) => f.type.startsWith('image/') || IMAGE_EXT.test(f.name);
export const isVideoFile = (f: File) => f.type.startsWith('video/') || VIDEO_EXT.test(f.name);

/** Resolves on `event`, rejects on `error` or after a timeout. */
function once(el: HTMLMediaElement, event: string, ms = 20_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      el.removeEventListener(event, ok);
      el.removeEventListener('error', bad);
    };
    const ok = () => {
      cleanup();
      resolve();
    };
    const bad = () => {
      cleanup();
      reject(new Error("This browser can't play that video format"));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out reading the video'));
    }, ms);
    el.addEventListener(event, ok);
    el.addEventListener('error', bad);
  });
}

export interface VideoInfo {
  thumb: ImageBitmap;
  duration: number;
  width: number;
  height: number;
}

/** Reads duration/size and grabs a thumbnail frame a little way into the clip. */
export async function readVideo(file: File, thumbEdge = 320): Promise<VideoInfo> {
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  try {
    const loaded = once(v, 'loadeddata');
    v.src = url;
    await loaded;
    const duration = Number.isFinite(v.duration) ? v.duration : 0;
    const t = Math.min(duration * 0.1, 1.5);
    if (t > 0.05) {
      const seeked = once(v, 'seeked');
      v.currentTime = t;
      await seeked;
    }
    const scale = Math.min(1, thumbEdge / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(v.videoWidth * scale));
    c.height = Math.max(1, Math.round(v.videoHeight * scale));
    c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
    return { thumb: await createImageBitmap(c), duration, width: v.videoWidth, height: v.videoHeight };
  } finally {
    v.removeAttribute('src');
    v.load();
    URL.revokeObjectURL(url);
  }
}

export const formatTime = (s: number) => {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
};

export const isHeic = (f: Blob) => /image\/hei[cf]/i.test(f.type) || /\.(heic|heif)$/i.test((f as File).name ?? '');

// iPhone HEIC photos: browsers other than Safari can't decode them, so convert once (lazily
// loading the ~3 MB libheif decoder) and reuse the result for thumbnail, preview and export.
const heicCache = new WeakMap<Blob, Promise<Blob>>();
function heicToJpeg(file: Blob): Promise<Blob> {
  let p = heicCache.get(file);
  if (!p) {
    p = import('heic-to').then(({ heicTo }) => heicTo({ blob: file, type: 'image/jpeg', quality: 0.95 }));
    heicCache.set(file, p);
    p.catch(() => heicCache.delete(file));
  }
  return p;
}

/** Decodes with EXIF rotation applied; shrinks to maxEdge if larger. */
export async function decodeImage(file: Blob, maxEdge = Infinity): Promise<ImageBitmap> {
  let full: ImageBitmap;
  try {
    full = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (e) {
    if (!isHeic(file)) throw e;
    full = await createImageBitmap(await heicToJpeg(file), { imageOrientation: 'from-image' });
  }
  const scale = Math.min(1, maxEdge / Math.max(full.width, full.height));
  if (scale >= 1) return full;
  const resized = await createImageBitmap(full, {
    resizeWidth: Math.max(1, Math.round(full.width * scale)),
    resizeHeight: Math.max(1, Math.round(full.height * scale)),
    resizeQuality: 'high',
  });
  full.close();
  return resized;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const stem = (name: string) => name.replace(/\.[^.]+$/, '');
export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'edit';
