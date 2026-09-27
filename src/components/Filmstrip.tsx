import { memo, useEffect, useRef } from 'react';
import { drawThumb } from '../engine/thumbs';
import { formatTime } from '../lib/files';
import type { Photo } from '../lib/types';

const Thumb = memo(function Thumb({ photo }: { photo: Photo }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!photo.thumb) return;
    const id = setTimeout(() => {
      if (ref.current && photo.thumb) drawThumb(ref.current, photo.thumb, photo.settings);
    }, 80);
    return () => clearTimeout(id);
  }, [photo.thumb, photo.settings]);
  return photo.thumb ? <canvas ref={ref} className="thumb-img" /> : <div className="thumb-img thumb-loading" />;
});

interface Props {
  photos: Photo[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
}

export function Filmstrip({ photos, activeId, onSelect, onRemove, onAdd }: Props) {
  const videos = photos.filter((p) => p.kind === 'video').length;
  const images = photos.length - videos;
  const counts = [images && `${images} photo${images === 1 ? '' : 's'}`, videos && `${videos} video${videos === 1 ? '' : 's'}`].filter(Boolean).join(' · ');

  return (
    <div className="filmstrip">
      <div className="filmstrip-scroll">
        {photos.map((p) => (
          <div key={p.id} className={`thumb${p.id === activeId ? ' is-active' : ''}`}>
            <button className="thumb-btn" onClick={() => onSelect(p.id)} title={`${p.name}${p.templateName ? ` · ${p.templateName}` : ''}`}>
              <Thumb photo={p} />
              {p.kind === 'video' && (
                <span className="thumb-video">
                  {p.trim ? '✂' : '▶'} {formatTime(p.trim ? p.trim.end - p.trim.start : (p.duration ?? 0))}
                </span>
              )}
              {p.templateName && (
                <span className="thumb-tag">
                  {p.templateName}
                  {p.amount !== 100 ? ` ${p.amount}%` : ''}
                  {p.edited ? ' •' : ''}
                </span>
              )}
            </button>
            <button className="thumb-remove" aria-label={`Remove ${p.name}`} onClick={() => onRemove(p.id)}>
              ✕
            </button>
          </div>
        ))}
        <button className="thumb thumb-add" onClick={onAdd} aria-label="Add photos or videos">
          +
        </button>
      </div>
      <div className="filmstrip-count muted">{counts} · ← → to switch</div>
    </div>
  );
}
