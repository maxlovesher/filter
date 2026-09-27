import { useState } from 'react';

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  defaultValue?: number;
  onChange: (v: number) => void;
  /** CSS background for the track (e.g. a temperature gradient). Defaults to a fill from the default value. */
  track?: string;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Lightroom-style slider: click the number to type a value, double-click the label or track to reset. */
export function Slider({ label, value, min, max, step = 1, defaultValue = 0, onChange, track }: SliderProps) {
  const [editing, setEditing] = useState(false);
  const decimals = step < 1 ? (String(step).split('.')[1]?.length ?? 2) : 0;
  const text = (min < 0 && value > 0 ? '+' : '') + value.toFixed(decimals);

  const pct = (v: number) => ((v - min) / (max - min)) * 100;
  const a = pct(Math.min(value, defaultValue));
  const b = pct(Math.max(value, defaultValue));
  const background =
    track ??
    `linear-gradient(90deg, var(--track) ${a}%, var(--fill) ${a}%, var(--fill) ${b}%, var(--track) ${b}%)`;

  const commit = (raw: string) => {
    const n = parseFloat(raw.replace(/[−–]/g, '-'));
    if (Number.isFinite(n)) onChange(clamp(Number(n.toFixed(decimals)), min, max));
    setEditing(false);
  };

  return (
    <div className={`slider${value !== defaultValue ? ' is-changed' : ''}`}>
      <div className="slider-head">
        <span className="slider-label" onDoubleClick={() => onChange(defaultValue)} title="Double-click to reset">
          {label}
        </span>
        {editing ? (
          <input
            className="slider-input"
            autoFocus
            defaultValue={String(value)}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={(e) => commit(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit(e.currentTarget.value);
              if (e.key === 'Escape') setEditing(false);
            }}
          />
        ) : (
          <button className="slider-value" onClick={() => setEditing(true)} title="Click to type a value">
            {text}
          </button>
        )}
      </div>
      <input
        type="range"
        className="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ background }}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        onDoubleClick={() => onChange(defaultValue)}
      />
    </div>
  );
}
