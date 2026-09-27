import { useState } from 'react';
import { HSL_COLORS, type HslAdjust, type HslColor } from '../lib/types';
import { Slider } from './Slider';

export const COLOR_HUE: Record<HslColor, number> = {
  red: 0, orange: 30, yellow: 60, green: 120, aqua: 180, blue: 240, purple: 270, magenta: 300,
};
const label = (c: string) => c.charAt(0).toUpperCase() + c.slice(1);
const changed = (a: HslAdjust) => a.hue !== 0 || a.sat !== 0 || a.lum !== 0;

interface Props {
  hsl: Record<HslColor, HslAdjust>;
  onChange: (color: HslColor, patch: Partial<HslAdjust>) => void;
}

function ColorSliders({ color, value, onChange }: { color: HslColor; value: HslAdjust; onChange: Props['onChange'] }) {
  const h = COLOR_HUE[color];
  return (
    <>
      <Slider
        label="Hue"
        value={value.hue}
        min={-100}
        max={100}
        onChange={(v) => onChange(color, { hue: v })}
        track={`linear-gradient(90deg, hsl(${h - 30} 65% 50%), hsl(${h} 65% 50%), hsl(${h + 30} 65% 50%))`}
      />
      <Slider
        label="Saturation"
        value={value.sat}
        min={-100}
        max={100}
        onChange={(v) => onChange(color, { sat: v })}
        track={`linear-gradient(90deg, hsl(${h} 0% 45%), hsl(${h} 75% 50%))`}
      />
      <Slider
        label="Luminance"
        value={value.lum}
        min={-100}
        max={100}
        onChange={(v) => onChange(color, { lum: v })}
        track={`linear-gradient(90deg, hsl(${h} 60% 12%), hsl(${h} 60% 50%), hsl(${h} 60% 88%))`}
      />
    </>
  );
}

/** Lightroom's Color Mixer: all eight color bands, one at a time or all at once. */
export function ColorMixer({ hsl, onChange }: Props) {
  const [active, setActive] = useState<HslColor>('red');
  const [showAll, setShowAll] = useState(false);

  return (
    <div className="mixer">
      <div className="mixer-head">
        {!showAll && (
          <div className="mixer-dots" role="tablist" aria-label="Color">
            {HSL_COLORS.map((c) => (
              <button
                key={c}
                role="tab"
                aria-selected={active === c}
                aria-label={label(c)}
                title={label(c)}
                className={`mixer-dot${active === c ? ' is-active' : ''}`}
                style={{ '--c': `hsl(${COLOR_HUE[c]} 80% 55%)` } as React.CSSProperties}
                onClick={() => setActive(c)}
              >
                {changed(hsl[c]) && <span className="dot" />}
              </button>
            ))}
          </div>
        )}
        <button className="link-btn" onClick={() => setShowAll(!showAll)}>
          {showAll ? 'One at a time' : 'Show all'}
        </button>
      </div>
      {showAll ? (
        HSL_COLORS.map((c) => (
          <div key={c} className="mixer-group">
            <div className="mixer-group-title">
              <span className="swatch" style={{ background: `hsl(${COLOR_HUE[c]} 80% 55%)` }} />
              {label(c)}
            </div>
            <ColorSliders color={c} value={hsl[c]} onChange={onChange} />
          </div>
        ))
      ) : (
        <>
          <div className="mixer-title">{label(active)}</div>
          <ColorSliders color={active} value={hsl[active]} onChange={onChange} />
        </>
      )}
    </div>
  );
}
