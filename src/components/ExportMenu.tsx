import { useEffect, useRef, useState } from 'react';

/** What the user picked in the menu. */
export interface ExportOptions {
  scope: 'current' | 'all' | 'cube';
  format: 'jpeg' | 'png';
  quality: number;
  toFolder: boolean;
  /** Longest side in px, or null for original size. */
  maxEdge: number | null;
}

const SIZES: { label: string; value: number | null }[] = [
  { label: 'Original', value: null },
  { label: '4K · 3840', value: 3840 },
  { label: '2048', value: 2048 },
  { label: 'Instagram · 1080', value: 1080 },
];

interface Props {
  count: number;
  currentKind: 'image' | 'video' | null;
  busy: boolean;
  onExport: (o: ExportOptions) => void;
}

const canPickFolder = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

export function ExportMenu({ count, currentKind, busy, onExport }: Props) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<'jpeg' | 'png'>('jpeg');
  const [quality, setQuality] = useState(92);
  const [maxEdge, setMaxEdge] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);

  const go = (scope: ExportOptions['scope'], toFolder = false) => {
    setOpen(false);
    onExport({ scope, format, quality, toFolder, maxEdge });
  };

  return (
    <div className="menu" ref={ref}>
      <button className="btn btn-accent" disabled={busy} onClick={() => setOpen(!open)} aria-expanded={open}>
        Export
      </button>
      {open && (
        <div className="menu-pop" role="menu">
          <div className="menu-row">
            <span className="muted">Photos as</span>
            <div className="seg small">
              <button className={`seg-btn${format === 'jpeg' ? ' is-active' : ''}`} onClick={() => setFormat('jpeg')}>
                JPG
              </button>
              <button className={`seg-btn${format === 'png' ? ' is-active' : ''}`} onClick={() => setFormat('png')}>
                PNG
              </button>
            </div>
          </div>
          {format === 'jpeg' && (
            <label className="menu-row">
              <span className="muted">Quality {quality}</span>
              <input type="range" className="range plain" min={60} max={100} value={quality} onChange={(e) => setQuality(+e.target.value)} />
            </label>
          )}
          <label className="menu-row">
            <span className="muted">Size (long side)</span>
            <select className="select menu-select" value={maxEdge ?? ''} onChange={(e) => setMaxEdge(e.target.value ? Number(e.target.value) : null)}>
              {SIZES.map((s) => (
                <option key={s.label} value={s.value ?? ''}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          {currentKind && (
            <button className="menu-item" onClick={() => go('current')}>
              Export this {currentKind === 'video' ? 'video (MP4)' : 'photo'}
            </button>
          )}
          {count > 1 && (
            <>
              <button className="menu-item" onClick={() => go('all')}>
                Export all {count} as ZIP
              </button>
              {canPickFolder && (
                <button className="menu-item" onClick={() => go('all', true)}>
                  Save all {count} into a folder…
                </button>
              )}
            </>
          )}
          <div className="menu-sep" />
          <button className="menu-item" onClick={() => go('cube')}>
            Export this look as .cube LUT
            <span className="menu-hint">for CapCut, Premiere, VN, phone apps</span>
          </button>
          <p className="menu-note muted small">Each item keeps its own settings · videos keep their sound (MP4, up to 4K)</p>
        </div>
      )}
    </div>
  );
}
