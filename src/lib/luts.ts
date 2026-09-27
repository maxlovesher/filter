/**
 * 3D LUTs (.cube). Stored as 8-bit RGB, red varying fastest (the .cube order), max 33³ so a
 * few dozen fit in localStorage. Ids are content hashes, so the same LUT imported twice — or
 * shipped inside a template file — always gets the same id.
 */
export interface Lut {
  id: string;
  name: string;
  size: number;
  data: Uint8Array;
}

export interface LutFile {
  name: string;
  size: number;
  data: string; // base64
}

const KEY = 'fiilter.luts.v1';
export const MAX_LUT_SIZE = 33;

const registry = new Map<string, Lut>();
const listeners = new Set<() => void>();
let loaded = false;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function lutId(size: number, data: Uint8Array): string {
  let h = 0x811c9dc5 ^ size;
  for (let i = 0; i < data.length; i++) {
    h ^= data[i];
    h = Math.imul(h, 0x01000193);
  }
  return `lut-${(h >>> 0).toString(16).padStart(8, '0')}`;
}

function valid(size: unknown, data: Uint8Array): size is number {
  return typeof size === 'number' && Number.isInteger(size) && size >= 2 && size <= MAX_LUT_SIZE && data.length === size ** 3 * 3;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function load() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = storage()?.getItem(KEY);
    if (raw) importLutFiles(JSON.parse(raw), false);
  } catch {
    // corrupt storage — start empty
  }
}

function persist(): boolean {
  try {
    const s = storage();
    if (!s) return false;
    s.setItem(KEY, JSON.stringify(exportLutFiles([...registry.keys()])));
    return true;
  } catch {
    return false;
  }
}

let version = 0;
const notify = () => {
  version++;
  listeners.forEach((fn) => fn());
};

/** Changes whenever the LUT list changes (for useSyncExternalStore). */
export const getLutsVersion = () => version;

export function subscribeLuts(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getLut(id: string | null | undefined): Lut | undefined {
  load();
  return id ? registry.get(id) : undefined;
}

export function listLuts(): Lut[] {
  load();
  return [...registry.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Registers a LUT (deduplicated by content). `persisted` is false if storage is full. */
export function addLut(name: string, size: number, data: Uint8Array): { lut: Lut; persisted: boolean } {
  load();
  const id = lutId(size, data);
  const existing = registry.get(id);
  if (existing) return { lut: existing, persisted: true };
  const lut = { id, name: name.slice(0, 80) || 'LUT', size, data };
  registry.set(id, lut);
  const persisted = persist();
  notify();
  return { lut, persisted };
}

export function removeLut(id: string): void {
  load();
  if (registry.delete(id)) {
    persist();
    notify();
  }
}

export function exportLutFiles(ids: Iterable<string>): Record<string, LutFile> {
  const out: Record<string, LutFile> = {};
  for (const id of ids) {
    const l = registry.get(id);
    if (l) out[id] = { name: l.name, size: l.size, data: toBase64(l.data) };
  }
  return out;
}

/** Accepts the object written by exportLutFiles. Returns how many LUTs were added. */
export function importLutFiles(obj: unknown, save = true): number {
  if (!obj || typeof obj !== 'object') return 0;
  let n = 0;
  for (const [id, v] of Object.entries(obj as Record<string, unknown>)) {
    const f = v as Partial<LutFile> | null;
    if (!f || typeof f.data !== 'string' || typeof f.name !== 'string') continue;
    try {
      const data = fromBase64(f.data);
      if (!valid(f.size, data)) continue;
      if (lutId(f.size, data) !== id || registry.has(id)) continue;
      registry.set(id, { id, name: f.name.slice(0, 80), size: f.size, data });
      n++;
    } catch {
      // skip bad entry
    }
  }
  if (n && save) {
    persist();
    notify();
  }
  return n;
}

/** Trilinear lookup into a float LUT (values 0..1, red fastest). */
function sample(lut: Float32Array, size: number, r: number, g: number, b: number): [number, number, number] {
  const m = size - 1;
  const fr = clamp01(r) * m;
  const fg = clamp01(g) * m;
  const fb = clamp01(b) * m;
  const r0 = Math.min(Math.floor(fr), m - 1);
  const g0 = Math.min(Math.floor(fg), m - 1);
  const b0 = Math.min(Math.floor(fb), m - 1);
  const dr = fr - r0;
  const dg = fg - g0;
  const db = fb - b0;
  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const at = (ri: number, gi: number, bi: number) => lut[((bi * size + gi) * size + ri) * 3 + c];
    const c00 = at(r0, g0, b0) * (1 - dr) + at(r0 + 1, g0, b0) * dr;
    const c10 = at(r0, g0 + 1, b0) * (1 - dr) + at(r0 + 1, g0 + 1, b0) * dr;
    const c01 = at(r0, g0, b0 + 1) * (1 - dr) + at(r0 + 1, g0, b0 + 1) * dr;
    const c11 = at(r0, g0 + 1, b0 + 1) * (1 - dr) + at(r0 + 1, g0 + 1, b0 + 1) * dr;
    out[c] = (c00 * (1 - dg) + c10 * dg) * (1 - db) + (c01 * (1 - dg) + c11 * dg) * db;
  }
  return out;
}

export interface ParsedCube {
  title: string | null;
  size: number;
  data: Uint8Array;
}

/** Parses an Adobe/Resolve .cube 3D LUT; larger LUTs are resampled down to 33³. */
export function parseCube(text: string): ParsedCube {
  let size = 0;
  let title: string | null = null;
  let dMin = [0, 0, 0];
  let dMax = [1, 1, 1];
  const values: number[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const upper = line.toUpperCase();
    if (upper.startsWith('TITLE')) {
      title = line.replace(/^TITLE\s*/i, '').replace(/^"|"$/g, '').trim() || null;
    } else if (upper.startsWith('LUT_3D_SIZE')) {
      size = parseInt(line.split(/\s+/)[1], 10);
    } else if (upper.startsWith('LUT_1D_SIZE')) {
      throw new Error('1D LUTs are not supported — use a 3D .cube LUT.');
    } else if (upper.startsWith('DOMAIN_MIN')) {
      dMin = line.split(/\s+/).slice(1, 4).map(Number);
    } else if (upper.startsWith('DOMAIN_MAX')) {
      dMax = line.split(/\s+/).slice(1, 4).map(Number);
    } else if (/^[-+\d.]/.test(line)) {
      const parts = line.split(/\s+/);
      if (parts.length >= 3) values.push(Number(parts[0]), Number(parts[1]), Number(parts[2]));
    }
  }
  if (!Number.isInteger(size) || size < 2 || size > 256) throw new Error('Missing or invalid LUT_3D_SIZE.');
  if (values.length !== size ** 3 * 3 || values.some((v) => !Number.isFinite(v))) {
    throw new Error(`Expected ${size ** 3} color rows for a ${size}³ LUT.`);
  }
  const floats = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const c = i % 3;
    floats[i] = clamp01((values[i] - dMin[c]) / (dMax[c] - dMin[c] || 1));
  }

  const outSize = Math.min(size, MAX_LUT_SIZE);
  const data = new Uint8Array(outSize ** 3 * 3);
  const m = outSize - 1;
  for (let b = 0; b < outSize; b++) {
    for (let g = 0; g < outSize; g++) {
      for (let r = 0; r < outSize; r++) {
        const i = ((b * outSize + g) * outSize + r) * 3;
        const v = outSize === size ? [floats[i], floats[i + 1], floats[i + 2]] : sample(floats, size, r / m, g / m, b / m);
        data[i] = Math.round(v[0] * 255);
        data[i + 1] = Math.round(v[1] * 255);
        data[i + 2] = Math.round(v[2] * 255);
      }
    }
  }
  return { title, size: outSize, data };
}

/** Writes a .cube file from 8-bit RGB data (red fastest). */
export function writeCube(title: string, size: number, rgb: Uint8Array): string {
  const lines = [
    `TITLE "${title.replace(/"/g, "'")}"`,
    '# Made with fiilter - color only (grain, clarity, texture, dehaze and vignette cannot live in a LUT)',
    `LUT_3D_SIZE ${size}`,
    'DOMAIN_MIN 0.0 0.0 0.0',
    'DOMAIN_MAX 1.0 1.0 1.0',
  ];
  for (let i = 0; i < rgb.length; i += 3) {
    lines.push(`${(rgb[i] / 255).toFixed(6)} ${(rgb[i + 1] / 255).toFixed(6)} ${(rgb[i + 2] / 255).toFixed(6)}`);
  }
  return lines.join('\n') + '\n';
}
