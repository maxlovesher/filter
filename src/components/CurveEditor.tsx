import { useMemo, useRef, useState } from 'react';
import { identityCurve, isIdentity, makeSpline } from '../lib/curve';
import type { CurveChannel, CurvePoint } from '../lib/types';

const CHANNELS: { key: CurveChannel; label: string; color: string }[] = [
  { key: 'master', label: 'RGB', color: '#e8e8ec' },
  { key: 'red', label: 'Red', color: '#ff6b6b' },
  { key: 'green', label: 'Green', color: '#5fd67c' },
  { key: 'blue', label: 'Blue', color: '#6ba6ff' },
];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

interface Props {
  curve: Record<CurveChannel, CurvePoint[]>;
  onChange: (curve: Record<CurveChannel, CurvePoint[]>) => void;
}

/** Point curve like Lightroom's: click to add, drag to move, double-click a point to remove. */
export function CurveEditor({ curve, onChange }: Props) {
  const [ch, setCh] = useState<CurveChannel>('master');
  const [drag, setDrag] = useState<number | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const pts = curve[ch];
  const color = CHANNELS.find((c) => c.key === ch)!.color;

  const path = useMemo(() => {
    const f = makeSpline(pts);
    let d = '';
    for (let x = 0; x <= 255; x += 1.5) d += `${d ? 'L' : 'M'}${x.toFixed(1)},${(255 - f(x)).toFixed(1)}`;
    return d;
  }, [pts]);

  const setPts = (next: CurvePoint[]) => onChange({ ...curve, [ch]: next });

  const coord = (e: React.PointerEvent | React.MouseEvent): CurvePoint => {
    const r = svgRef.current!.getBoundingClientRect();
    return [
      Math.round(clamp(((e.clientX - r.left) / r.width) * 255, 0, 255)),
      Math.round(clamp((1 - (e.clientY - r.top) / r.height) * 255, 0, 255)),
    ];
  };
  const hit = ([x, y]: CurvePoint) => pts.findIndex((p) => Math.hypot(p[0] - x, p[1] - y) < 12);

  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const c = coord(e);
    let idx = hit(c);
    if (idx === -1) {
      const sameX = pts.findIndex((p) => p[0] === c[0]);
      if (sameX !== -1) idx = sameX;
      else {
        const next = [...pts, c].sort((a, b) => a[0] - b[0]);
        idx = next.indexOf(c);
        setPts(next);
      }
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag(idx);
    setSel(idx);
  };

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (drag === null) return;
    const [x, y] = coord(e);
    const next = pts.map((p) => [...p] as CurvePoint);
    const lo = drag === 0 ? 0 : next[drag - 1][0] + 1;
    const hi = drag === next.length - 1 ? 255 : next[drag + 1][0] - 1;
    next[drag] = [clamp(x, lo, hi), y];
    setPts(next);
  };

  const onDouble = (e: React.MouseEvent) => {
    const idx = hit(coord(e));
    if (idx > 0 && idx < pts.length - 1) {
      setPts(pts.filter((_, i) => i !== idx));
      setSel(null);
    }
  };

  const selPt = sel !== null ? pts[sel] : undefined;

  return (
    <div className="curve">
      <div className="curve-tabs" role="tablist">
        {CHANNELS.map((c) => (
          <button
            key={c.key}
            role="tab"
            aria-selected={ch === c.key}
            className={`curve-tab${ch === c.key ? ' is-active' : ''}`}
            onClick={() => {
              setCh(c.key);
              setSel(null);
            }}
          >
            <span className="swatch" style={{ background: c.color }} />
            {c.label}
            {!isIdentity(curve[c.key]) && <span className="dot" />}
          </button>
        ))}
      </div>
      <svg
        ref={svgRef}
        className="curve-svg"
        viewBox="0 0 255 255"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={() => setDrag(null)}
        onPointerCancel={() => setDrag(null)}
        onDoubleClick={onDouble}
      >
        <defs>
          <linearGradient id="curve-bg" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#000" stopOpacity="0.35" />
            <stop offset="1" stopColor="#fff" stopOpacity="0.06" />
          </linearGradient>
        </defs>
        <rect width="255" height="255" fill="url(#curve-bg)" />
        {[64, 128, 191].map((v) => (
          <g key={v} className="curve-grid">
            <line x1={v} y1={0} x2={v} y2={255} />
            <line x1={0} y1={v} x2={255} y2={v} />
          </g>
        ))}
        <line className="curve-diag" x1={0} y1={255} x2={255} y2={0} />
        <path d={path} fill="none" stroke={color} strokeWidth={1.6} />
        {pts.map((p, i) => (
          <circle
            key={i}
            cx={p[0]}
            cy={255 - p[1]}
            r={i === sel ? 5 : 4}
            className={`curve-pt${i === sel ? ' is-sel' : ''}`}
            style={{ stroke: color }}
          />
        ))}
      </svg>
      <div className="curve-foot">
        <span className="muted">
          {selPt ? `Input ${selPt[0]} · Output ${selPt[1]}` : 'Click to add · drag · double-click removes'}
        </span>
        {!isIdentity(pts) && (
          <button className="link-btn" onClick={() => setPts(identityCurve())}>
            Reset {ch === 'master' ? 'RGB' : ch}
          </button>
        )}
      </div>
    </div>
  );
}
