import { useRef, useState } from 'react';
import { GRADE_ZONES, type GradeZone, type GradeZoneName, type Settings } from '../lib/types';
import { Slider } from './Slider';

const ZONE_LABEL: Record<GradeZoneName, string> = {
  shadows: 'Shadows',
  midtones: 'Midtones',
  highlights: 'Highlights',
  global: 'Global',
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Hue = angle (0° red at 3 o'clock, counter-clockwise like Lightroom), saturation = distance from center. */
function ColorWheel({ hue, sat, onChange }: { hue: number; sat: number; onChange: (hue: number, sat: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const update = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    const deg = ((Math.atan2(-dy, dx) * 180) / Math.PI + 360) % 360;
    const s = clamp(Math.hypot(dx, dy) / (r.width / 2), 0, 1);
    onChange(Math.round(deg), Math.round(s * 100));
  };

  const rad = (hue * Math.PI) / 180;
  const x = 50 + Math.cos(rad) * (sat / 100) * 50;
  const y = 50 - Math.sin(rad) * (sat / 100) * 50;

  return (
    <div
      ref={ref}
      className="wheel"
      role="slider"
      aria-label="Hue and saturation"
      aria-valuetext={`Hue ${hue}, saturation ${sat}`}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
        update(e);
      }}
      onPointerMove={(e) => dragging && update(e)}
      onPointerUp={() => setDragging(false)}
      onPointerCancel={() => setDragging(false)}
      onDoubleClick={() => onChange(0, 0)}
      title="Drag to pick a tint · double-click to reset"
    >
      <div className="wheel-puck" style={{ left: `${x}%`, top: `${y}%`, background: `hsl(${hue} ${sat}% ${100 - sat / 2}%)` }} />
    </div>
  );
}

interface Props {
  grading: Settings['grading'];
  onZone: (zone: GradeZoneName, patch: Partial<GradeZone>) => void;
  onGlobal: (patch: { blending?: number; balance?: number }) => void;
}

export function ColorGrading({ grading, onZone, onGlobal }: Props) {
  const [zone, setZone] = useState<GradeZoneName>('shadows');
  const z = grading[zone];

  return (
    <div className="grading">
      <div className="seg" role="tablist" aria-label="Tonal range">
        {GRADE_ZONES.map((name) => {
          const g = grading[name];
          return (
            <button
              key={name}
              role="tab"
              aria-selected={zone === name}
              className={`seg-btn${zone === name ? ' is-active' : ''}`}
              onClick={() => setZone(name)}
            >
              {ZONE_LABEL[name]}
              {(g.sat !== 0 || g.lum !== 0) && <span className="dot" style={{ background: `hsl(${g.hue} 70% 60%)` }} />}
            </button>
          );
        })}
      </div>

      <ColorWheel hue={z.hue} sat={z.sat} onChange={(hue, sat) => onZone(zone, { hue, sat })} />

      <Slider
        label="Hue"
        value={z.hue}
        min={0}
        max={360}
        onChange={(v) => onZone(zone, { hue: v })}
        track="linear-gradient(90deg, hsl(0 65% 50%), hsl(60 65% 50%), hsl(120 65% 50%), hsl(180 65% 50%), hsl(240 65% 50%), hsl(300 65% 50%), hsl(360 65% 50%))"
      />
      <Slider
        label="Saturation"
        value={z.sat}
        min={0}
        max={100}
        onChange={(v) => onZone(zone, { sat: v })}
        track={`linear-gradient(90deg, hsl(${z.hue} 0% 45%), hsl(${z.hue} 75% 50%))`}
      />
      <Slider label="Luminance" value={z.lum} min={-100} max={100} onChange={(v) => onZone(zone, { lum: v })} />

      <div className="grading-shared">
        <Slider label="Blending" value={grading.blending} min={0} max={100} defaultValue={50} onChange={(v) => onGlobal({ blending: v })} />
        <Slider label="Balance" value={grading.balance} min={-100} max={100} onChange={(v) => onGlobal({ balance: v })} />
      </div>
    </div>
  );
}
