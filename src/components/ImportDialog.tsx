import { useEffect, useMemo, useState } from 'react';
import { parseRecipe } from '../lib/recipe';
import { defaultSettings, mergeSettings } from '../lib/defaults';
import type { Settings } from '../lib/types';

interface Props {
  current: Settings;
  onClose: () => void;
  onRecipe: (settings: Settings, name: string, save: boolean) => void;
  onFiles: (files: File[]) => void;
}

const EXAMPLE = `Exposure +0.60  Contrast -30  Highlights -54  Shadows +34  Whites +13  Blacks +78
Temp -8  Tint +5  Vibrance +46  Saturation +49
Clarity -57  Dehaze -22  Grain 72
Red: Hue +5 Sat -9     Orange: Hue +13 Sat -13     Purple: Sat +15
Color grading  Shadows: Hue 225 Sat 12   Highlights: Hue 286 Sat 19
Tone curve (0,49) (69,60) (111,87) (182,158) (219,209) (255,234)`;

export function ImportDialog({ current, onClose, onRecipe, onFiles }: Props) {
  const [tab, setTab] = useState<'recipe' | 'file'>('recipe');
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [onTop, setOnTop] = useState(false);
  const parsed = useMemo(() => parseRecipe(text), [text]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const build = () => mergeSettings(onTop ? current : defaultSettings(), parsed.patch);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="import-title">
        <header className="modal-head">
          <h2 id="import-title">Import a look</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="seg" role="tablist">
          <button role="tab" aria-selected={tab === 'recipe'} className={`seg-btn${tab === 'recipe' ? ' is-active' : ''}`} onClick={() => setTab('recipe')}>
            Type / paste a recipe
          </button>
          <button role="tab" aria-selected={tab === 'file'} className={`seg-btn${tab === 'file' ? ' is-active' : ''}`} onClick={() => setTab('file')}>
            Preset / LUT file
          </button>
        </div>

        {tab === 'recipe' ? (
          <div className="modal-body">
            <p className="muted">
              Write the numbers from the reel however you like — the sliders fill in as you type.{' '}
              <button className="link-btn" onClick={() => setText(EXAMPLE)}>
                Show an example
              </button>
            </p>
            <textarea
              className="recipe-input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={'Exposure +0.6\nContrast -30\nOrange: Hue +13 Sat -13\nShadows: Hue 225 Sat 12\n…'}
              rows={8}
              autoFocus
              spellCheck={false}
            />
            <div className="chips" aria-live="polite">
              {parsed.found.length === 0 ? (
                <span className="muted small">Nothing recognised yet.</span>
              ) : (
                parsed.found.map((f, i) => (
                  <span key={i} className="chip">
                    {f}
                  </span>
                ))
              )}
            </div>
            <label className="check">
              <input type="checkbox" checked={onTop} onChange={(e) => setOnTop(e.target.checked)} />
              Build on top of my current edit (otherwise start from zero)
            </label>
            <div className="modal-actions">
              <input className="grow" value={name} onChange={(e) => setName(e.target.value)} placeholder="Template name (to save it)" maxLength={80} />
              <button className="btn" disabled={!parsed.found.length} onClick={() => onRecipe(build(), name.trim() || 'Pasted recipe', false)}>
                Just apply
              </button>
              <button className="btn btn-accent" disabled={!parsed.found.length || !name.trim()} onClick={() => onRecipe(build(), name.trim(), true)}>
                Save as template
              </button>
            </div>
          </div>
        ) : (
          <div className="modal-body">
            <p className="muted">
              Lightroom / Camera Raw presets (<code>.xmp</code>) and fiilter template files (<code>.json</code>) become templates;
              LUTs (<code>.cube</code>) are added to the LUT list. You can also just drop them on the window.
            </p>
            <label className="file-drop">
              <input
                type="file"
                accept=".xmp,.json,.cube,application/json"
                multiple
                onChange={(e) => {
                  const files = [...(e.target.files ?? [])];
                  if (files.length) {
                    onFiles(files);
                    onClose();
                  }
                }}
              />
              Choose preset files…
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
