import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Renderer } from '../engine/renderer';
import { decodeImage, formatTime } from '../lib/files';
import type { Photo, Settings } from '../lib/types';
import { computeHistogram, type HistogramData } from './Histogram';

const PREVIEW_EDGE = 2048;
const VIDEO_PREVIEW_EDGE = 1280;
const CACHE_SIZE = 4;
const previewCache = new Map<string, ImageBitmap>();

async function getPreview(photo: Photo): Promise<ImageBitmap> {
  const hit = previewCache.get(photo.id);
  if (hit) {
    previewCache.delete(photo.id);
    previewCache.set(photo.id, hit);
    return hit;
  }
  const bmp = await decodeImage(photo.file, PREVIEW_EDGE);
  previewCache.set(photo.id, bmp);
  while (previewCache.size > CACHE_SIZE) {
    const [oldest, old] = previewCache.entries().next().value!;
    previewCache.delete(oldest);
    old.close();
  }
  return bmp;
}

export function forgetPreview(id: string) {
  previewCache.get(id)?.close();
  previewCache.delete(id);
}

let histCanvas: HTMLCanvasElement | null = null;

interface Props {
  photo: Photo | null;
  settings: Settings;
  /** Name of a template being hovered, shown as a temporary preview. */
  previewName: string | null;
  onPickFiles: () => void;
  onHistogram: (h: HistogramData | null) => void;
  /** Sets (or clears) the video's export in/out points. */
  onTrim: (trim: { start: number; end: number } | null) => void;
}

export function Viewer({ photo, settings, previewName, onPickFiles, onHistogram, onTrim }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const beforeRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const workRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const settingsRef = useRef(settings);
  const histRef = useRef(onHistogram);
  const histTimer = useRef(0);
  const imgRef = useRef<{ id: string; w: number; h: number } | null>(null);
  const trimRef = useRef<{ start: number; end: number } | null>(null);
  settingsRef.current = settings;
  histRef.current = onHistogram;
  trimRef.current = photo?.kind === 'video' ? (photo.trim ?? null) : null;

  /** Keeps playback inside the trim range. */
  const enforceTrim = (v: HTMLVideoElement) => {
    const t = trimRef.current;
    if (t && !v.paused && (v.currentTime >= t.end - 0.03 || v.currentTime < t.start - 0.25)) v.currentTime = t.start;
  };

  const [error, setError] = useState<string | null>(null);
  const [img, setImgState] = useState<{ id: string; w: number; h: number } | null>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [compare, setCompare] = useState(false);
  const [split, setSplit] = useState(50);
  const [showBefore, setShowBefore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);

  const setImg = (v: { id: string; w: number; h: number } | null) => {
    imgRef.current = v;
    setImgState(v);
  };

  // One WebGL context for the life of the page.
  useEffect(() => {
    if (rendererRef.current || !canvasRef.current) return;
    try {
      rendererRef.current = new Renderer(canvasRef.current);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setStage({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scheduleHistogram = () => {
    if (histTimer.current) return;
    histTimer.current = window.setTimeout(() => {
      histTimer.current = 0;
      const c = canvasRef.current;
      if (!c || !c.width || !imgRef.current) return;
      histCanvas ??= document.createElement('canvas');
      const s = Math.min(1, 220 / Math.max(c.width, c.height));
      histCanvas.width = Math.max(1, Math.round(c.width * s));
      histCanvas.height = Math.max(1, Math.round(c.height * s));
      const ctx = histCanvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(c, 0, 0, histCanvas.width, histCanvas.height);
      histRef.current(computeHistogram(ctx.getImageData(0, 0, histCanvas.width, histCanvas.height).data));
    }, 140);
  };

  const renderNow = () => {
    const r = rendererRef.current;
    if (!r || !imgRef.current) return;
    r.render(settingsRef.current);
    scheduleHistogram();
  };

  /** Pull the current video frame through the engine. */
  const drawVideoFrame = () => {
    const v = videoRef.current;
    const work = workRef.current;
    const r = rendererRef.current;
    if (!v || !work || !r || v.readyState < 2 || !imgRef.current) return;
    work.getContext('2d')!.drawImage(v, 0, 0, work.width, work.height);
    r.setImage(work);
    renderNow();
    beforeRef.current?.getContext('2d')?.drawImage(work, 0, 0);
  };

  const photoId = photo?.id;
  useEffect(() => {
    setImg(null);
    setPlaying(false);
    setTime(0);
    setDuration(0);
    if (!photo) {
      histRef.current(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    if (photo.kind === 'image') {
      getPreview(photo)
        .then((bmp) => {
          if (cancelled || !rendererRef.current) return;
          rendererRef.current.setImage(bmp);
          const bc = beforeRef.current!;
          bc.width = bmp.width;
          bc.height = bmp.height;
          bc.getContext('2d')?.drawImage(bmp, 0, 0);
          setImg({ id: photo.id, w: bmp.width, h: bmp.height });
        })
        .catch(() => !cancelled && setError(`Couldn't open ${photo.name}`))
        .finally(() => !cancelled && setLoading(false));
      return () => {
        cancelled = true;
      };
    }

    // video
    const v = videoRef.current!;
    const url = URL.createObjectURL(photo.file);
    const onLoaded = () => {
      if (cancelled) return;
      const s = Math.min(1, VIDEO_PREVIEW_EDGE / Math.max(v.videoWidth, v.videoHeight));
      const w = Math.max(2, Math.round(v.videoWidth * s));
      const h = Math.max(2, Math.round(v.videoHeight * s));
      workRef.current ??= document.createElement('canvas');
      workRef.current.width = w;
      workRef.current.height = h;
      beforeRef.current!.width = w;
      beforeRef.current!.height = h;
      setDuration(Number.isFinite(v.duration) ? v.duration : 0);
      setImg({ id: photo.id, w, h });
      setLoading(false);
      drawVideoFrame();
    };
    const onError = () => {
      if (cancelled) return;
      setLoading(false);
      setError(`This browser can't play ${photo.name}`);
    };
    v.addEventListener('loadeddata', onLoaded, { once: true });
    v.addEventListener('error', onError, { once: true });
    v.src = url;
    v.load();
    return () => {
      cancelled = true;
      v.removeEventListener('loadeddata', onLoaded);
      v.removeEventListener('error', onError);
      v.pause();
      v.removeAttribute('src');
      v.load();
      URL.revokeObjectURL(url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoId]);

  // Re-render whenever the look changes (for a paused video the last frame is still on the GPU).
  useEffect(() => {
    if (!img || !rendererRef.current) return;
    const id = requestAnimationFrame(renderNow);
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, img]);

  // Video element events
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onSeeked = () => drawVideoFrame();
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTime = () => {
      enforceTrim(v);
      setTime(v.currentTime);
    };
    v.addEventListener('seeked', onSeeked);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('timeupdate', onTime);
    return () => {
      v.removeEventListener('seeked', onSeeked);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('timeupdate', onTime);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // While playing, grade every new frame.
  useEffect(() => {
    const v = videoRef.current;
    if (!playing || !v) return;
    let stop = false;
    let handle = 0;
    if ('requestVideoFrameCallback' in v) {
      const cb = () => {
        if (stop) return;
        enforceTrim(v);
        drawVideoFrame();
        handle = v.requestVideoFrameCallback(cb);
      };
      handle = v.requestVideoFrameCallback(cb);
      return () => {
        stop = true;
        v.cancelVideoFrameCallback(handle);
      };
    }
    const tick = () => {
      if (stop) return;
      enforceTrim(v);
      drawVideoFrame();
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => {
      stop = true;
      cancelAnimationFrame(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  const isVideo = photo?.kind === 'video';
  const togglePlay = () => {
    const v = videoRef.current;
    if (!v || !img) return;
    if (v.paused) {
      const t = trimRef.current;
      if (t && (v.currentTime < t.start || v.currentTime >= t.end - 0.05)) v.currentTime = t.start;
      void v.play().catch(() => setError("Couldn't start playback"));
    } else v.pause();
  };

  const trim = trimRef.current;
  const setTrimPoint = (which: 'start' | 'end') => {
    const start = which === 'start' ? time : (trim?.start ?? 0);
    const end = which === 'end' ? time : (trim?.end ?? duration);
    if (end - start < 0.2) return; // ignore an empty/inverted range
    onTrim(start <= 0.01 && end >= duration - 0.01 ? null : { start, end });
  };
  const pct = (s: number) => (duration ? (s / duration) * 100 : 0);
  const scrubTrack = trim
    ? `linear-gradient(90deg, var(--track) ${pct(trim.start)}%, var(--accent) ${pct(trim.start)}%, var(--accent) ${pct(trim.end)}%, var(--track) ${pct(trim.end)}%)`
    : undefined;

  // "\" toggles the original (like Lightroom); space plays/pauses videos.
  const toggleRef = useRef(togglePlay);
  toggleRef.current = togglePlay;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === '\\') setShowBefore((v) => !v);
      if (e.key === ' ' && videoRef.current?.getAttribute('src')) {
        e.preventDefault();
        toggleRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const pad = 24;
  const scale = img ? Math.min((stage.w - pad * 2) / img.w, (stage.h - pad * 2) / img.h, 2) : 0;
  const fw = img ? Math.max(0, Math.floor(img.w * scale)) : 0;
  const fh = img ? Math.max(0, Math.floor(img.h * scale)) : 0;

  const setSplitFrom = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setSplit(Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)));
  };

  const beforeClip = showBefore ? 'none' : compare ? `inset(0 ${100 - split}% 0 0)` : 'inset(0 100% 0 0)';

  return (
    <div className="viewer">
      <div className="stage" ref={stageRef}>
        <div
          className={`frame${compare && !showBefore ? ' is-compare' : ''}`}
          style={{ width: fw, height: fh, visibility: img && photo ? 'visible' : 'hidden' }}
          onPointerDown={(e) => {
            if (!compare) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            setSplitFrom(e);
          }}
          onPointerMove={(e) => compare && e.buttons === 1 && setSplitFrom(e)}
          onClick={() => isVideo && !compare && togglePlay()}
        >
          <canvas ref={canvasRef} className="frame-canvas" />
          <canvas ref={beforeRef} className="frame-canvas frame-before" style={{ clipPath: beforeClip }} />
          {compare && !showBefore && (
            <>
              <div className="split-line" style={{ left: `${split}%` }}>
                <span className="split-knob" />
              </div>
              <span className="frame-label left">Before</span>
              <span className="frame-label right">After</span>
            </>
          )}
          {showBefore && <span className="frame-label left">Original</span>}
          {previewName && !showBefore && <span className="frame-preview-tag">Preview · {previewName}</span>}
          {isVideo && !playing && img && !compare && (
            <span className="frame-play" aria-hidden>
              ▶
            </span>
          )}
        </div>

        <video ref={videoRef} className="video-src" playsInline loop preload="auto" muted={muted} aria-hidden />

        {!photo && !error && (
          <div className="empty">
            <div className="empty-art" aria-hidden>
              <span />
              <span />
              <span />
            </div>
            <h1>Grade once. Reuse forever.</h1>
            <p>Drop photos or videos anywhere, pick or build a template, and everything gets the look.</p>
            <button className="btn btn-accent btn-lg" onClick={onPickFiles}>
              Add photos & videos
            </button>
            <p className="muted small">JPG, PNG, WebP, AVIF, MP4, MOV, WebM · nothing leaves your computer</p>
          </div>
        )}
        {error && <div className="viewer-error">{error}</div>}
        {loading && <div className="viewer-loading">Loading…</div>}
      </div>

      {photo && (
        <div className="viewer-bar">
          {isVideo && (
            <div className="player">
              <button className="icon-btn play-btn" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'} title="Play / pause (space)">
                {playing ? '❚❚' : '▶'}
              </button>
              <input
                type="range"
                className="range plain scrub"
                min={0}
                max={duration || 0}
                step={0.01}
                value={Math.min(time, duration || 0)}
                aria-label="Seek"
                style={scrubTrack ? { background: scrubTrack } : undefined}
                onChange={(e) => {
                  const t = parseFloat(e.target.value);
                  setTime(t);
                  if (videoRef.current) videoRef.current.currentTime = t;
                }}
              />
              <span className="muted small time">
                {formatTime(time)} / {formatTime(duration)}
              </span>
              <button className="icon-btn" onClick={() => setMuted(!muted)} aria-label={muted ? 'Unmute' : 'Mute'} title={muted ? 'Unmute' : 'Mute'}>
                {muted ? '🔇' : '🔊'}
              </button>
              <span className="trim">
                <button className="btn btn-small btn-ghost" onClick={() => setTrimPoint('start')} title="Export starts at the playhead">
                  [ Start
                </button>
                <button className="btn btn-small btn-ghost" onClick={() => setTrimPoint('end')} title="Export ends at the playhead">
                  End ]
                </button>
                {trim && (
                  <span className="trim-tag" title="Only this part is exported">
                    ✂ {formatTime(trim.start)}–{formatTime(trim.end)}
                    <button className="icon-btn" aria-label="Clear trim" onClick={() => onTrim(null)}>
                      ✕
                    </button>
                  </span>
                )}
              </span>
            </div>
          )}
          <div className="seg small">
            <button className={`seg-btn${!compare ? ' is-active' : ''}`} onClick={() => setCompare(false)}>
              After
            </button>
            <button className={`seg-btn${compare ? ' is-active' : ''}`} onClick={() => setCompare(true)}>
              Before / After
            </button>
          </div>
          <button
            className="btn btn-ghost btn-small"
            onPointerDown={() => setShowBefore(true)}
            onPointerUp={() => setShowBefore(false)}
            onPointerLeave={() => setShowBefore(false)}
            title="Hold to see the original (or press \)"
          >
            Hold for original
          </button>
          {!isVideo && <span className="muted small viewer-name">{photo.name}</span>}
        </div>
      )}
    </div>
  );
}
