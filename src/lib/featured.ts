import { importLutFiles } from './luts';
import { parseTemplateList } from './storage';
import type { Template } from './types';

/**
 * Site-wide templates. Every *.json file in /templates (the app's own "Export template file"
 * format) is bundled at build time and shown to every visitor under "Featured".
 * Any LUTs those templates use travel inside the files.
 */
const files = import.meta.glob('/templates/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;

const fileSlug = (path: string) =>
  path
    .replace(/^.*\//, '')
    .replace(/\.json$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');

export const FEATURED_TEMPLATES: Template[] = Object.keys(files)
  .sort()
  .flatMap((path) => {
    const data = files[path] as { luts?: unknown } | null;
    if (data && typeof data === 'object') importLutFiles(data.luts, false);
    // Stable ids (file name + position) so edits that point at a featured template survive reloads.
    return parseTemplateList(data).map((t, i) => ({ ...t, id: `featured-${fileSlug(path)}-${i}`, builtin: true }));
  });
