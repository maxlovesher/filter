import { memo, useEffect, useRef, useState } from 'react';
import { drawThumb } from '../engine/thumbs';
import type { Settings, Template } from '../lib/types';

export type ApplyScope = 'one' | 'all';

interface Props {
  /** Site-wide templates shipped in /templates. */
  featured: Template[];
  builtins: Template[];
  userTemplates: Template[];
  activeId: string | null;
  scope: ApplyScope;
  photoCount: number;
  /** Small bitmap of the current photo, used to preview every template on it. */
  previewBitmap: ImageBitmap | null;
  onScope: (s: ApplyScope) => void;
  onApply: (t: Template) => void;
  onHover: (t: Template | null) => void;
  onSaveNew: (name: string) => void;
  onUpdate: (t: Template) => void;
  onRename: (t: Template, name: string) => void;
  onDelete: (t: Template) => void;
  onDuplicate: (t: Template) => void;
  onExport: (ts: Template[]) => void;
  onExportCube: (t: Template) => void;
  onImport: () => void;
}

/** A tiny render of the template on the current photo. */
const TemplatePreview = memo(function TemplatePreview({ bitmap, settings }: { bitmap: ImageBitmap | null; settings: Settings }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!bitmap) return;
    const id = setTimeout(() => ref.current && drawThumb(ref.current, bitmap, settings), 120);
    return () => clearTimeout(id);
  }, [bitmap, settings]);
  return bitmap ? <canvas ref={ref} className="tpl-thumb" aria-hidden /> : <span className="tpl-thumb tpl-thumb-empty" aria-hidden />;
});

interface MenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
}

function ItemMenu({ items, label }: { items: MenuItem[]; label: string }) {
  const [open, setOpen] = useState(false);
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
  return (
    <div className="tpl-menu" ref={ref}>
      <button className="icon-btn" aria-label={`More actions for ${label}`} aria-expanded={open} onClick={() => setOpen(!open)}>
        ⋯
      </button>
      {open && (
        <div className="tpl-menu-pop" role="menu">
          {items.map((it) => (
            <button
              key={it.label}
              role="menuitem"
              className={`menu-item${it.danger ? ' danger' : ''}`}
              onClick={() => {
                setOpen(false);
                it.onClick();
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TemplateRow({
  t,
  active,
  bitmap,
  menu,
  onApply,
  onHover,
  renaming,
  onRenameDone,
}: {
  t: Template;
  active: boolean;
  bitmap: ImageBitmap | null;
  menu: MenuItem[];
  onApply: () => void;
  onHover: (on: boolean) => void;
  renaming?: boolean;
  onRenameDone?: (name: string | null) => void;
}) {
  return (
    <li className={`tpl${active ? ' is-active' : ''}`} onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)}>
      {renaming ? (
        <form
          className="tpl-rename"
          onSubmit={(e) => {
            e.preventDefault();
            onRenameDone?.(new FormData(e.currentTarget).get('name')?.toString().trim() || null);
          }}
        >
          <input name="name" defaultValue={t.name} autoFocus onBlur={(e) => e.currentTarget.form?.requestSubmit()} maxLength={80} aria-label="Template name" />
        </form>
      ) : (
        <button className="tpl-main" onClick={onApply} onFocus={() => onHover(true)} onBlur={() => onHover(false)}>
          <TemplatePreview bitmap={bitmap} settings={t.settings} />
          <span className="tpl-text">
            <span className="tpl-name">{t.name}</span>
            {t.note && <span className="tpl-note">{t.note}</span>}
          </span>
        </button>
      )}
      <ItemMenu items={menu} label={t.name} />
    </li>
  );
}

export function TemplateList(props: Props) {
  const { featured, builtins, userTemplates, activeId, scope, photoCount, previewBitmap } = props;

  const readOnlyRows = (list: Template[]) =>
    list.map((t) => (
      <TemplateRow
        key={t.id}
        t={t}
        active={activeId === t.id}
        bitmap={previewBitmap}
        onApply={() => props.onApply(t)}
        onHover={hover(t)}
        menu={[
          { label: 'Copy to My templates', onClick: () => props.onDuplicate(t) },
          { label: 'Export template file', onClick: () => props.onExport([t]) },
          { label: 'Export as .cube LUT', onClick: () => props.onExportCube(t) },
        ]}
      />
    ));
  const [name, setName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);

  const hover = (t: Template) => (on: boolean) => props.onHover(on ? t : null);

  return (
    <div className="templates">
      <div className="panel-title">Templates</div>

      <form
        className="save-form"
        onSubmit={(e) => {
          e.preventDefault();
          const n = name.trim();
          if (!n) return;
          props.onSaveNew(n);
          setName('');
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name this look…" maxLength={80} aria-label="New template name" />
        <button className="btn btn-accent" disabled={!name.trim()}>
          Save
        </button>
      </form>

      {photoCount > 1 && (
        <div className="scope">
          <span className="muted">Clicking a template applies to</span>
          <div className="seg small">
            <button className={`seg-btn${scope === 'all' ? ' is-active' : ''}`} onClick={() => props.onScope('all')}>
              All {photoCount}
            </button>
            <button className={`seg-btn${scope === 'one' ? ' is-active' : ''}`} onClick={() => props.onScope('one')}>
              This one
            </button>
          </div>
        </div>
      )}

      <div className="tpl-group">
        <div className="tpl-group-head">
          <span>My templates</span>
          <span className="tpl-group-actions">
            <button className="link-btn" onClick={props.onImport}>
              Import
            </button>
            {userTemplates.length > 0 && (
              <button className="link-btn" onClick={() => props.onExport(userTemplates)}>
                Export all
              </button>
            )}
          </span>
        </div>
        {userTemplates.length === 0 ? (
          <p className="empty-note">
            Set the sliders from a reel, then name it above. It'll be here next time — one click applies it to every photo and video.
          </p>
        ) : (
          <ul className="tpl-list">
            {userTemplates.map((t) => (
              <TemplateRow
                key={t.id}
                t={t}
                active={activeId === t.id}
                bitmap={previewBitmap}
                onApply={() => props.onApply(t)}
                onHover={hover(t)}
                renaming={renamingId === t.id}
                onRenameDone={(n) => {
                  if (n) props.onRename(t, n);
                  setRenamingId(null);
                }}
                menu={[
                  { label: 'Overwrite with current settings', onClick: () => props.onUpdate(t) },
                  { label: 'Rename', onClick: () => setRenamingId(t.id) },
                  { label: 'Duplicate', onClick: () => props.onDuplicate(t) },
                  { label: 'Export template file', onClick: () => props.onExport([t]) },
                  { label: 'Export as .cube LUT', onClick: () => props.onExportCube(t) },
                  { label: 'Delete', onClick: () => props.onDelete(t), danger: true },
                ]}
              />
            ))}
          </ul>
        )}
      </div>

      {featured.length > 0 && (
        <div className="tpl-group">
          <div className="tpl-group-head">
            <span>Featured</span>
          </div>
          <ul className="tpl-list">{readOnlyRows(featured)}</ul>
        </div>
      )}

      <div className="tpl-group">
        <div className="tpl-group-head">
          <span>Starter looks</span>
        </div>
        <ul className="tpl-list">{readOnlyRows(builtins)}</ul>
      </div>
    </div>
  );
}
