import { defaultSettings, mergeSettings } from './defaults';
import { exportLutFiles, importLutFiles } from './luts';
import type { Template } from './types';

const KEY = 'fiilter.templates.v1';

export const newId = () => crypto.randomUUID();

/** Accepts our export format, a bare array, or a single {name, settings}. Missing fields fall back to defaults. */
export function parseTemplateList(data: unknown, freshIds = true): Template[] {
  const obj = data as Record<string, unknown> | null;
  const list: unknown[] = Array.isArray(data)
    ? data
    : obj && typeof obj === 'object' && Array.isArray(obj.templates)
      ? (obj.templates as unknown[])
      : obj && typeof obj === 'object' && 'settings' in obj
        ? [obj]
        : [];
  const out: Template[] = [];
  for (const item of list) {
    const t = item as Record<string, unknown> | null;
    if (!t || typeof t !== 'object' || typeof t.name !== 'string' || !t.settings || typeof t.settings !== 'object') continue;
    out.push({
      id: !freshIds && typeof t.id === 'string' ? t.id : newId(),
      name: t.name.slice(0, 80),
      settings: mergeSettings(defaultSettings(), t.settings),
      ...(typeof t.note === 'string' && t.note.trim() ? { note: t.note.slice(0, 160) } : {}),
    });
  }
  return out;
}

export function loadUserTemplates(): Template[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? parseTemplateList(JSON.parse(raw), false) : [];
  } catch {
    return [];
  }
}

export function saveUserTemplates(templates: Template[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(templates.map(({ id, name, settings }) => ({ id, name, settings }))));
  } catch {
    // storage full or blocked — templates still live for this session
  }
}

/** Template file; any LUTs the templates use travel inside it so the look is complete on another machine. */
export function templatesToJson(templates: Template[]): string {
  const lutIds = new Set(templates.map((t) => t.settings.lut.id).filter((id): id is string => !!id));
  return JSON.stringify(
    {
      app: 'fiilter',
      version: 1,
      templates: templates.map(({ name, settings }) => ({ name, settings })),
      luts: exportLutFiles(lutIds),
    },
    null,
    2,
  );
}

/** Reads a template file (registering bundled LUTs first). */
export function templatesFromJson(text: string): Template[] {
  const data = JSON.parse(text) as { luts?: unknown };
  if (data && typeof data === 'object' && 'luts' in data) importLutFiles(data.luts);
  return parseTemplateList(data);
}
