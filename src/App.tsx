import { useEffect, useMemo, useRef, useState } from 'react';
import { EditPanel } from './components/EditPanel';
import { ExportMenu, type ExportOptions } from './components/ExportMenu';
import { Filmstrip } from './components/Filmstrip';
import { Histogram, type HistogramData } from './components/Histogram';
import { ImportDialog } from './components/ImportDialog';
import { Slider } from './components/Slider';
import { TemplateList, type ApplyScope } from './components/TemplateList';
import { forgetPreview, Viewer } from './components/Viewer';
import { bakeCube } from './engine/bake';
import { ExportCanceled, exportItems } from './engine/export';
import { BUILTIN_TEMPLATES, defaultSettings, mergeSettings, scaleSettings, type DeepPartial } from './lib/defaults';
import { FEATURED_TEMPLATES } from './lib/featured';
import { decodeImage, downloadBlob, isImageFile, isVideoFile, LUT_EXT, PRESET_EXT, readVideo, slug, stem } from './lib/files';
import { addLut, parseCube, type Lut } from './lib/luts';
import { loadUserTemplates, newId, saveUserTemplates, templatesFromJson, templatesToJson } from './lib/storage';
import type { Look, Photo, Settings, Template } from './lib/types';
import { parseXmp } from './lib/xmp';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const blankLook = (): Look => ({ settings: defaultSettings(), templateId: null, templateName: null, amount: 100, edited: false });
const lookOf = (x: Look): Look => ({
  settings: x.settings,
  templateId: x.templateId,
  templateName: x.templateName,
  amount: x.amount,
  edited: x.edited,
});
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Shape of a patch (keys only), so dragging one slider collapses into a single undo step. */
const signature = (v: unknown): string =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? Object.keys(v)
        .sort()
        .map((k) => `${k}(${signature((v as Record<string, unknown>)[k])})`)
        .join(',')
    : '';

interface Snapshot {
  draft: Look;
  looks: Record<string, Look>;
}
const HISTORY_LIMIT = 60;

const isTyping = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

export default function App() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Edits made before any photo is added (e.g. building a template from a recipe).
  const [draft, setDraft] = useState<Look>(blankLook);
  const [userTemplates, setUserTemplates] = useState<Template[]>(loadUserTemplates);
  const [scope, setScope] = useState<ApplyScope>('all');
  const [lastApplied, setLastApplied] = useState<Look | null>(null);
  const [hovered, setHovered] = useState<Template | null>(null);
  const [histogram, setHistogram] = useState<HistogramData | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [, setHistoryTick] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const lutInput = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const past = useRef<Snapshot[]>([]);
  const future = useRef<Snapshot[]>([]);
  const lastRecord = useRef<{ key: string; t: number } | null>(null);
  const clipboard = useRef<Settings | null>(null);

  const active = photos.find((p) => p.id === activeId) ?? null;
  const current: Look = active ?? draft;
  const allTemplates = useMemo(() => [...userTemplates, ...FEATURED_TEMPLATES, ...BUILTIN_TEMPLATES], [userTemplates]);
  const currentTemplate = current.templateId ? (allTemplates.find((t) => t.id === current.templateId) ?? null) : null;

  useEffect(() => saveUserTemplates(userTemplates), [userTemplates]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (photos.length && !photos.some((p) => p.id === activeId)) setActiveId(photos[0].id);
    if (!photos.length && activeId) setActiveId(null);
  }, [photos, activeId]);

  // Photos live only in this tab — warn before a reload/close throws the work away.
  const hasWork = photos.length > 0;
  useEffect(() => {
    if (!hasWork) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasWork]);

  // ---------- undo / redo ----------

  const snapshot = (): Snapshot => ({ draft, looks: Object.fromEntries(photos.map((p) => [p.id, lookOf(p)])) });

  /** Call before changing any look. Calls with the same key in quick succession merge into one step. */
  const record = (key?: string) => {
    const now = performance.now();
    const last = lastRecord.current;
    if (key && last && last.key === key && now - last.t < 900) {
      last.t = now;
      return;
    }
    past.current.push(snapshot());
    if (past.current.length > HISTORY_LIMIT) past.current.shift();
    future.current = [];
    lastRecord.current = key ? { key, t: now } : null;
    setHistoryTick((t) => t + 1);
  };

  const restore = (s: Snapshot) => {
    setDraft(s.draft);
    setPhotos((ps) => ps.map((p) => (s.looks[p.id] ? { ...p, ...s.looks[p.id] } : p)));
  };

  const undo = () => {
    const s = past.current.pop();
    if (!s) return;
    future.current.push(snapshot());
    restore(s);
    lastRecord.current = null;
    setHistoryTick((t) => t + 1);
  };

  const redo = () => {
    const s = future.current.pop();
    if (!s) return;
    past.current.push(snapshot());
    restore(s);
    lastRecord.current = null;
    setHistoryTick((t) => t + 1);
  };

  // ---------- editing ----------

  const updateLook = (fn: (l: Look) => Look) => {
    if (activeId) setPhotos((ps) => ps.map((p) => (p.id === activeId ? { ...p, ...fn(p) } : p)));
    else setDraft((d) => fn(d));
  };

  const patchSettings = (patch: DeepPartial<Settings>) => {
    record(`patch:${activeId}:${signature(patch)}`);
    updateLook((l) => ({ ...l, settings: mergeSettings(l.settings, patch), edited: true }));
  };

  const lookFromTemplate = (t: Template, amount = 100): Look => ({
    settings: amount === 100 ? structuredClone(t.settings) : scaleSettings(t.settings, amount / 100),
    templateId: t.id,
    templateName: t.name,
    amount,
    edited: false,
  });

  const applyLook = (look: Look) => {
    record();
    const put = <T extends Look>(p: T): T => ({ ...p, ...look, settings: structuredClone(look.settings) });
    if (photos.length === 0) setDraft(put);
    else if (scope === 'all') setPhotos((ps) => ps.map(put));
    else setPhotos((ps) => ps.map((p) => (p.id === activeId ? put(p) : p)));
    setLastApplied(look);
  };

  const applyTemplate = (t: Template) => {
    setHovered(null);
    applyLook(lookFromTemplate(t));
  };

  /** Strength slider: re-derives the look from its template (on every item using it when applying to all). */
  const setStrength = (amount: number) => {
    if (!currentTemplate) return;
    record(`strength:${activeId}`);
    const look = lookFromTemplate(currentTemplate, amount);
    const put = <T extends Look>(p: T): T => ({ ...p, ...look, settings: structuredClone(look.settings) });
    if (!activeId) setDraft(put);
    else if (scope === 'all') setPhotos((ps) => ps.map((p) => (p.id === activeId || (p.templateId === currentTemplate.id && !p.edited) ? put(p) : p)));
    else setPhotos((ps) => ps.map((p) => (p.id === activeId ? put(p) : p)));
    setLastApplied(look);
  };

  const syncToAll = () => {
    record();
    const look = lookOf(current);
    setPhotos((ps) => ps.map((p) => ({ ...p, ...look, settings: structuredClone(look.settings) })));
    setLastApplied(look);
    setToast(`Copied this edit to all ${photos.length}`);
  };

  const resetCurrent = () => {
    record();
    updateLook(() => blankLook());
  };

  const copySettings = () => {
    clipboard.current = structuredClone(current.settings);
    setToast('Settings copied — select another photo and press Ctrl+V');
  };

  const pasteSettings = () => {
    const s = clipboard.current;
    if (!s) return;
    record();
    updateLook((l) => ({ ...l, settings: structuredClone(s), edited: true }));
    setToast('Settings pasted');
  };

  // ---------- templates ----------

  const markCurrentAs = (t: Template) => updateLook((l) => ({ ...l, templateId: t.id, templateName: t.name, amount: 100, edited: false }));

  const saveNewTemplate = (name: string) => {
    const t: Template = { id: newId(), name, settings: structuredClone(current.settings) };
    setUserTemplates((ts) => [t, ...ts]);
    markCurrentAs(t);
    setLastApplied(lookFromTemplate(t));
    setToast(`Saved “${name}” — it'll be here next time`);
  };

  const updateTemplate = (t: Template) => {
    const settings = structuredClone(current.settings);
    setUserTemplates((ts) => ts.map((x) => (x.id === t.id ? { ...x, settings } : x)));
    markCurrentAs(t);
    setToast(`Updated “${t.name}” with the current settings`);
  };

  const renameTemplate = (t: Template, name: string) => {
    setUserTemplates((ts) => ts.map((x) => (x.id === t.id ? { ...x, name } : x)));
    setPhotos((ps) => ps.map((p) => (p.templateId === t.id ? { ...p, templateName: name } : p)));
    setDraft((d) => (d.templateId === t.id ? { ...d, templateName: name } : d));
  };

  const duplicateTemplate = (t: Template) => {
    const copy: Template = { id: newId(), name: t.builtin ? t.name : `${t.name} copy`, settings: structuredClone(t.settings) };
    setUserTemplates((ts) => [copy, ...ts]);
    setToast(`“${copy.name}” added to My templates`);
  };

  const deleteTemplate = (t: Template) => {
    if (window.confirm(`Delete the template “${t.name}”?`)) setUserTemplates((ts) => ts.filter((x) => x.id !== t.id));
  };

  const exportTemplates = (ts: Template[]) => {
    const blob = new Blob([templatesToJson(ts)], { type: 'application/json' });
    downloadBlob(blob, ts.length === 1 ? `${slug(ts[0].name)}.fiilter.json` : 'fiilter-templates.json');
  };

  const exportCube = (settings: Settings, name: string) => {
    try {
      const text = bakeCube(settings, name);
      downloadBlob(new Blob([text], { type: 'text/plain' }), `${slug(name)}.cube`);
      setToast(`Saved ${slug(name)}.cube — grain, clarity and vignette aren't included (LUTs are color only)`);
    } catch (e) {
      setToast(`Couldn't make the LUT: ${errorText(e)}`);
    }
  };

  const importPresetFiles = async (files: File[]) => {
    const imported: Template[] = [];
    for (const f of files) {
      try {
        const text = await f.text();
        if (/\.xmp$/i.test(f.name)) {
          const { name, patch } = parseXmp(text, stem(f.name));
          imported.push({ id: newId(), name, settings: mergeSettings(defaultSettings(), patch) });
        } else {
          imported.push(...templatesFromJson(text));
        }
      } catch {
        // unreadable file — reported below if nothing at all came through
      }
    }
    if (imported.length) {
      setUserTemplates((ts) => [...imported, ...ts]);
      setToast(`Imported ${plural(imported.length, 'template')}`);
    } else {
      setToast("Couldn't find any presets in that file.");
    }
  };

  const importCubeFiles = async (files: File[], applyToCurrent: boolean) => {
    let last: Lut | null = null;
    const problems: string[] = [];
    let unsaved = 0;
    for (const f of files) {
      try {
        const parsed = parseCube(await f.text());
        const { lut, persisted } = addLut(parsed.title ?? stem(f.name), parsed.size, parsed.data);
        if (!persisted) unsaved++;
        last = lut;
      } catch (e) {
        problems.push(`${f.name}: ${errorText(e)}`);
      }
    }
    if (last && applyToCurrent) patchSettings({ lut: { id: last.id, amount: 100 } });
    if (problems.length) setToast(problems.join(' · '));
    else if (unsaved) setToast('LUT loaded, but storage is full — it will be gone after a reload. Remove old LUTs to make room.');
    else if (last) setToast(files.length > 1 ? `Added ${plural(files.length, 'LUT')}` : `LUT “${last.name}” applied`);
  };

  const onRecipe = (settings: Settings, name: string, save: boolean) => {
    if (save) {
      const t: Template = { id: newId(), name, settings };
      setUserTemplates((ts) => [t, ...ts]);
      setToast(`Saved “${name}”`);
      applyLook(lookFromTemplate(t));
    } else {
      applyLook({ settings, templateId: null, templateName: name, amount: 100, edited: true });
    }
    setImportOpen(false);
  };

  // ---------- photos & videos ----------

  const addFiles = async (files: File[]) => {
    const media = files.filter((f) => isVideoFile(f) || isImageFile(f));
    const presets = files.filter((f) => PRESET_EXT.test(f.name));
    const cubes = files.filter((f) => LUT_EXT.test(f.name));
    if (presets.length) await importPresetFiles(presets);
    if (cubes.length) await importCubeFiles(cubes, true);
    if (!media.length) {
      if (!presets.length && !cubes.length && files.length) setToast("Those aren't files I can open (photos, videos, .xmp, .json, .cube).");
      return;
    }
    // New items pick up the look you're working with.
    const base: Look = photos.length === 0 ? draft : (lastApplied ?? blankLook());
    const created: Photo[] = media.map((file) => ({
      ...lookOf(base),
      settings: structuredClone(base.settings),
      id: newId(),
      kind: isVideoFile(file) ? 'video' : 'image',
      file,
      name: file.name,
      thumb: null,
    }));
    setPhotos((ps) => [...ps, ...created]);
    setActiveId((id) => id ?? created[0].id);

    const failed: string[] = [];
    for (const p of created) {
      try {
        if (p.kind === 'video') {
          const info = await readVideo(p.file);
          setPhotos((ps) => ps.map((x) => (x.id === p.id ? { ...x, thumb: info.thumb, duration: info.duration } : x)));
        } else {
          const thumb = await decodeImage(p.file, 320);
          setPhotos((ps) => ps.map((x) => (x.id === p.id ? { ...x, thumb } : x)));
        }
      } catch {
        failed.push(p.name);
        setPhotos((ps) => ps.filter((x) => x.id !== p.id));
      }
    }
    if (failed.length) {
      setToast(`Couldn't open ${failed.join(', ')}. HEIC/RAW photos and some HEVC videos need converting first.`);
    }
  };

  const addFilesRef = useRef(addFiles);
  addFilesRef.current = addFiles;
  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__fiilter = { addFiles: (f: File[]) => addFilesRef.current(f) };
  }, []);

  const removePhoto = (id: string) => {
    setPhotos((ps) => {
      ps.find((p) => p.id === id)?.thumb?.close();
      return ps.filter((p) => p.id !== id);
    });
    forgetPreview(id);
  };

  // ---------- keyboard ----------

  const keysRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keysRef.current = (e: KeyboardEvent) => {
    if (isTyping(e)) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && key === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
    } else if (mod && ((key === 'z' && e.shiftKey) || key === 'y')) {
      e.preventDefault();
      redo();
    } else if (mod && key === 'c' && !window.getSelection()?.toString()) {
      copySettings();
    } else if (mod && key === 'v' && clipboard.current) {
      e.preventDefault();
      pasteSettings();
    } else if (!mod && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && photos.length) {
      const i = photos.findIndex((p) => p.id === activeId);
      const next = photos[(i + (e.key === 'ArrowRight' ? 1 : -1) + photos.length) % photos.length];
      setActiveId(next.id);
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keysRef.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ---------- export ----------

  const runExport = async (opts: ExportOptions) => {
    if (opts.scope === 'cube') {
      exportCube(current.settings, current.templateName ?? 'fiilter-look');
      return;
    }
    const list = opts.scope === 'all' ? photos : active ? [active] : [];
    if (!list.length || progress) return;

    let dir: FileSystemDirectoryHandle | null = null;
    if (opts.toFolder) {
      try {
        dir = await (window as unknown as { showDirectoryPicker: (o: object) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker({ mode: 'readwrite' });
      } catch {
        return; // picker cancelled
      }
    }

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setProgress({ done: 0, total: list.length, label: list[0].name });
    try {
      const n = await exportItems(list, { format: opts.format, quality: opts.quality, maxEdge: opts.maxEdge }, {
        dir,
        signal: ctrl.signal,
        onProgress: (done, total, label) => setProgress({ done, total, label }),
      });
      setToast(dir ? `Saved ${plural(n, 'file')} to the folder` : `Exported ${plural(n, 'file')}`);
    } catch (e) {
      setToast(e instanceof ExportCanceled ? 'Export canceled' : `Export failed: ${errorText(e)}`);
    } finally {
      abortRef.current = null;
      setProgress(null);
    }
  };

  // ---------- layout ----------

  const pickFiles = () => fileInput.current?.click();
  const viewerSettings = hovered ? hovered.settings : current.settings;

  return (
    <div
      className="app"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.relatedTarget) setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        addFiles([...e.dataTransfer.files]);
      }}
    >
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            <span />
            <span />
          </span>
          fiilter
        </div>
        <div className="topbar-actions">
          <button className="btn" onClick={pickFiles}>
            Add photos & videos
          </button>
          <button className="btn" onClick={() => setImportOpen(true)}>
            Import
          </button>
          <ExportMenu count={photos.length} currentKind={active?.kind ?? null} busy={!!progress} onExport={runExport} />
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="image/*,video/*,.mov,.mkv,.xmp,.json,.cube"
          multiple
          hidden
          onChange={(e) => {
            addFiles([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
        <input
          ref={lutInput}
          type="file"
          accept=".cube"
          multiple
          hidden
          onChange={(e) => {
            importCubeFiles([...(e.target.files ?? [])], true);
            e.target.value = '';
          }}
        />
      </header>

      <aside className="left">
        <TemplateList
          featured={FEATURED_TEMPLATES}
          builtins={BUILTIN_TEMPLATES}
          userTemplates={userTemplates}
          activeId={current.templateId}
          scope={scope}
          photoCount={photos.length}
          previewBitmap={active?.thumb ?? null}
          onScope={setScope}
          onApply={applyTemplate}
          onHover={setHovered}
          onSaveNew={saveNewTemplate}
          onUpdate={updateTemplate}
          onRename={renameTemplate}
          onDelete={deleteTemplate}
          onDuplicate={duplicateTemplate}
          onExport={exportTemplates}
          onExportCube={(t) => exportCube(t.settings, t.name)}
          onImport={() => setImportOpen(true)}
        />
      </aside>

      <main className="center">
        <Viewer
          photo={active}
          settings={viewerSettings}
          previewName={hovered && hovered.id !== current.templateId ? hovered.name : null}
          onPickFiles={pickFiles}
          onHistogram={setHistogram}
          onTrim={(trim) => activeId && setPhotos((ps) => ps.map((p) => (p.id === activeId ? { ...p, trim } : p)))}
        />
        {photos.length > 0 && (
          <Filmstrip photos={photos} activeId={activeId} onSelect={setActiveId} onRemove={removePhoto} onAdd={pickFiles} />
        )}
      </main>

      <aside className="right">
        {active && <Histogram data={histogram} />}
        <div className="edit-head">
          <div className="edit-head-row">
            <div className="edit-title">
              <span className="muted small">{active ? `Editing this ${active.kind === 'video' ? 'video' : 'photo'}` : 'Building a look'}</span>
              <strong>
                {current.templateName ?? 'No template'}
                {current.edited && current.templateName ? <span className="edited"> · edited</span> : null}
              </strong>
            </div>
            <div className="edit-actions">
              <button className="icon-btn" onClick={undo} disabled={!past.current.length} aria-label="Undo" title="Undo (Ctrl+Z)">
                ↶
              </button>
              <button className="icon-btn" onClick={redo} disabled={!future.current.length} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">
                ↷
              </button>
            </div>
          </div>
          {currentTemplate && (
            <div className="strength">
              <Slider label="Template strength %" value={current.amount} min={0} max={200} defaultValue={100} onChange={setStrength} />
            </div>
          )}
          <div className="edit-head-row buttons">
            <button className="btn btn-small btn-ghost" onClick={copySettings} title="Copy settings (Ctrl+C)">
              Copy
            </button>
            <button className="btn btn-small btn-ghost" onClick={pasteSettings} disabled={!clipboard.current} title="Paste settings (Ctrl+V)">
              Paste
            </button>
            {photos.length > 1 && (
              <button className="btn btn-small" onClick={syncToAll} title="Copy these exact settings to every item">
                Apply to all {photos.length}
              </button>
            )}
            <button className="btn btn-small btn-ghost" onClick={resetCurrent}>
              Reset
            </button>
          </div>
        </div>
        <EditPanel settings={current.settings} onPatch={patchSettings} onLoadLut={() => lutInput.current?.click()} />
      </aside>

      {importOpen && (
        <ImportDialog
          current={current.settings}
          onClose={() => setImportOpen(false)}
          onRecipe={onRecipe}
          onFiles={(files) => {
            setImportOpen(false);
            addFiles(files);
          }}
        />
      )}
      {progress && (
        <div className="progress" role="status">
          <span className="progress-text">
            Exporting {Math.min(progress.total, Math.floor(progress.done) + 1)} / {progress.total}
            <span className="muted small"> {progress.label}</span>
          </span>
          <span className="progress-bar">
            <span style={{ width: `${(progress.done / progress.total) * 100}%` }} />
          </span>
          <button className="btn btn-small" onClick={() => abortRef.current?.abort()}>
            Cancel
          </button>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
      {dragOver && <div className="drop-overlay">Drop photos, videos, presets or LUTs</div>}
    </div>
  );
}
