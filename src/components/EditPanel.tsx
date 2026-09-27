import { useMemo, useState, useSyncExternalStore } from 'react';
import { defaultSettings, type DeepPartial } from '../lib/defaults';
import { isIdentity } from '../lib/curve';
import { getLut, getLutsVersion, listLuts, removeLut, subscribeLuts } from '../lib/luts';
import { CURVE_CHANNELS, GRADE_ZONES, HSL_COLORS, type Settings } from '../lib/types';
import { ColorGrading } from './ColorGrading';
import { ColorMixer } from './ColorMixer';
import { CurveEditor } from './CurveEditor';
import { Section } from './Section';
import { Slider } from './Slider';

interface Props {
  settings: Settings;
  onPatch: (patch: DeepPartial<Settings>) => void;
  /** Opens a file picker for .cube LUTs. */
  onLoadLut: () => void;
}

const D = defaultSettings();
const TEMP_TRACK = 'linear-gradient(90deg, #4f7fd1, #9aa4b4 50%, #d9b64a)';
const TINT_TRACK = 'linear-gradient(90deg, #4fae62, #9aa4b4 50%, #c35ac3)';

export function EditPanel({ settings: s, onPatch, onLoadLut }: Props) {
  const [vigDetails, setVigDetails] = useState(false);
  const [grainDetails, setGrainDetails] = useState(false);
  const lutsVersion = useSyncExternalStore(subscribeLuts, getLutsVersion);
  const luts = useMemo(() => listLuts(), [lutsVersion]);
  const lutMissing = !!s.lut.id && !getLut(s.lut.id);

  const lightChanged = (['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks'] as const).some((k) => s[k] !== D[k]);
  const colorChanged = (['temp', 'tint', 'vibrance', 'saturation'] as const).some((k) => s[k] !== D[k]);
  const effectsChanged =
    s.texture !== 0 || s.clarity !== 0 || s.dehaze !== 0 ||
    JSON.stringify(s.vignette) !== JSON.stringify(D.vignette) || JSON.stringify(s.grain) !== JSON.stringify(D.grain);
  const curveChanged = CURVE_CHANNELS.some((c) => !isIdentity(s.curve[c]));
  const mixerChanged = HSL_COLORS.some((c) => s.hsl[c].hue || s.hsl[c].sat || s.hsl[c].lum);
  const gradingChanged =
    GRADE_ZONES.some((z) => s.grading[z].sat || s.grading[z].lum) || s.grading.blending !== 50 || s.grading.balance !== 0;

  return (
    <div className="edit-panel">
      <Section
        title="Light"
        changed={lightChanged}
        onReset={() => onPatch({ exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 })}
      >
        <Slider label="Exposure" value={s.exposure} min={-5} max={5} step={0.01} onChange={(v) => onPatch({ exposure: v })} />
        <Slider label="Contrast" value={s.contrast} min={-100} max={100} onChange={(v) => onPatch({ contrast: v })} />
        <Slider label="Highlights" value={s.highlights} min={-100} max={100} onChange={(v) => onPatch({ highlights: v })} />
        <Slider label="Shadows" value={s.shadows} min={-100} max={100} onChange={(v) => onPatch({ shadows: v })} />
        <Slider label="Whites" value={s.whites} min={-100} max={100} onChange={(v) => onPatch({ whites: v })} />
        <Slider label="Blacks" value={s.blacks} min={-100} max={100} onChange={(v) => onPatch({ blacks: v })} />
      </Section>

      <Section title="Color" changed={colorChanged} onReset={() => onPatch({ temp: 0, tint: 0, vibrance: 0, saturation: 0 })}>
        <div className="sub-label">White balance</div>
        <Slider label="Temp" value={s.temp} min={-100} max={100} track={TEMP_TRACK} onChange={(v) => onPatch({ temp: v })} />
        <Slider label="Tint" value={s.tint} min={-100} max={100} track={TINT_TRACK} onChange={(v) => onPatch({ tint: v })} />
        <div className="sub-label">Presence</div>
        <Slider label="Vibrance" value={s.vibrance} min={-100} max={100} onChange={(v) => onPatch({ vibrance: v })} />
        <Slider label="Saturation" value={s.saturation} min={-100} max={100} onChange={(v) => onPatch({ saturation: v })} />
      </Section>

      <Section title="Color Mixer" changed={mixerChanged} onReset={() => onPatch({ hsl: D.hsl })}>
        <ColorMixer hsl={s.hsl} onChange={(color, patch) => onPatch({ hsl: { [color]: patch } })} />
      </Section>

      <Section title="Color Grading" changed={gradingChanged} onReset={() => onPatch({ grading: D.grading })}>
        <ColorGrading
          grading={s.grading}
          onZone={(zone, patch) => onPatch({ grading: { [zone]: patch } })}
          onGlobal={(patch) => onPatch({ grading: patch })}
        />
      </Section>

      <Section title="LUT" changed={!!s.lut.id} onReset={() => onPatch({ lut: { id: null, amount: 100 } })} defaultOpen={!!s.lut.id}>
        <div className="lut-row">
          <select
            className="select"
            value={s.lut.id ?? ''}
            aria-label="LUT"
            onChange={(e) => onPatch({ lut: { id: e.target.value || null } })}
          >
            <option value="">None</option>
            {luts.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
            {lutMissing && <option value={s.lut.id!}>Missing LUT</option>}
          </select>
          <button className="btn btn-small" onClick={onLoadLut}>
            Load .cube…
          </button>
        </div>
        {s.lut.id && !lutMissing && (
          <>
            <Slider label="Amount" value={s.lut.amount} min={0} max={100} defaultValue={100} onChange={(v) => onPatch({ lut: { amount: v } })} />
            <button
              className="link-btn danger-link"
              onClick={() => {
                if (window.confirm('Remove this LUT from fiilter? Templates using it will stop applying it.')) {
                  removeLut(s.lut.id!);
                  onPatch({ lut: { id: null } });
                }
              }}
            >
              Remove LUT from library
            </button>
          </>
        )}
        {lutMissing && <p className="muted small">This template uses a LUT that isn't on this computer. Load the same .cube file to restore it.</p>}
        <p className="muted small">Applied after color grading. Any 3D .cube LUT works (free ones from YouTube, reels, Resolve…).</p>
      </Section>

      <Section title="Tone Curve" changed={curveChanged} onReset={() => onPatch({ curve: D.curve })}>
        <CurveEditor curve={s.curve} onChange={(curve) => onPatch({ curve })} />
      </Section>

      <Section
        title="Effects"
        changed={effectsChanged}
        onReset={() => onPatch({ texture: 0, clarity: 0, dehaze: 0, vignette: D.vignette, grain: D.grain })}
      >
        <Slider label="Texture" value={s.texture} min={-100} max={100} onChange={(v) => onPatch({ texture: v })} />
        <Slider label="Clarity" value={s.clarity} min={-100} max={100} onChange={(v) => onPatch({ clarity: v })} />
        <Slider label="Dehaze" value={s.dehaze} min={-100} max={100} onChange={(v) => onPatch({ dehaze: v })} />

        <div className="detail-row">
          <div className="grow">
            <Slider label="Vignette" value={s.vignette.amount} min={-100} max={100} onChange={(v) => onPatch({ vignette: { amount: v } })} />
          </div>
          <button className="details-btn" aria-expanded={vigDetails} onClick={() => setVigDetails(!vigDetails)} title="Vignette details">
            {vigDetails ? '▾' : '◂'}
          </button>
        </div>
        {vigDetails && (
          <div className="details">
            <Slider label="Midpoint" value={s.vignette.midpoint} min={0} max={100} defaultValue={50} onChange={(v) => onPatch({ vignette: { midpoint: v } })} />
            <Slider label="Roundness" value={s.vignette.roundness} min={-100} max={100} onChange={(v) => onPatch({ vignette: { roundness: v } })} />
            <Slider label="Feather" value={s.vignette.feather} min={0} max={100} defaultValue={50} onChange={(v) => onPatch({ vignette: { feather: v } })} />
          </div>
        )}

        <div className="detail-row">
          <div className="grow">
            <Slider label="Grain" value={s.grain.amount} min={0} max={100} onChange={(v) => onPatch({ grain: { amount: v } })} />
          </div>
          <button className="details-btn" aria-expanded={grainDetails} onClick={() => setGrainDetails(!grainDetails)} title="Grain details">
            {grainDetails ? '▾' : '◂'}
          </button>
        </div>
        {grainDetails && (
          <div className="details">
            <Slider label="Size" value={s.grain.size} min={0} max={100} defaultValue={25} onChange={(v) => onPatch({ grain: { size: v } })} />
            <Slider label="Roughness" value={s.grain.roughness} min={0} max={100} defaultValue={50} onChange={(v) => onPatch({ grain: { roughness: v } })} />
          </div>
        )}
      </Section>
    </div>
  );
}
