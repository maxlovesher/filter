import { describe, expect, it } from 'vitest';
import { addLut, getLut, lutId, parseCube, writeCube, exportLutFiles, importLutFiles, fromBase64, toBase64 } from './luts';

function identityCube(size: number, domainMax = 1): string {
  const rows: string[] = [`LUT_3D_SIZE ${size}`, `DOMAIN_MAX ${domainMax} ${domainMax} ${domainMax}`];
  for (let b = 0; b < size; b++)
    for (let g = 0; g < size; g++)
      for (let r = 0; r < size; r++) rows.push([r, g, b].map((v) => ((v / (size - 1)) * domainMax).toFixed(5)).join(' '));
  return rows.join('\n');
}

describe('LUTs', () => {
  it('parses an identity cube', () => {
    const { size, data } = parseCube('TITLE "Id"\n# comment\n' + identityCube(3));
    expect(size).toBe(3);
    // middle entry r=1,g=1,b=1 → 0.5
    const mid = ((1 * 3 + 1) * 3 + 1) * 3;
    expect([data[mid], data[mid + 1], data[mid + 2]]).toEqual([128, 128, 128]);
    // r=2,g=0,b=0 → pure red
    expect([data[6], data[7], data[8]]).toEqual([255, 0, 0]);
  });

  it('respects DOMAIN_MAX', () => {
    const { data } = parseCube(identityCube(2, 2));
    expect(data[data.length - 1]).toBe(255);
  });

  it('downsamples big LUTs to 33 and stays identity', () => {
    const { size, data } = parseCube(identityCube(65));
    expect(size).toBe(33);
    const i = ((16 * 33 + 8) * 33 + 32) * 3; // r=32,g=8,b=16
    expect(data[i]).toBe(255);
    expect(data[i + 1]).toBe(Math.round((8 / 32) * 255));
    expect(data[i + 2]).toBe(Math.round((16 / 32) * 255));
  });

  it('rejects 1D and malformed LUTs', () => {
    expect(() => parseCube('LUT_1D_SIZE 4\n0 0 0')).toThrow(/1D/);
    expect(() => parseCube('LUT_3D_SIZE 2\n0 0 0')).toThrow(/Expected/);
  });

  it('round-trips through writeCube', () => {
    const a = parseCube(identityCube(5));
    const b = parseCube(writeCube('x', a.size, a.data));
    expect(Array.from(b.data)).toEqual(Array.from(a.data));
  });

  it('dedupes by content and survives export/import', () => {
    const a = parseCube(identityCube(4));
    const first = addLut('One', a.size, a.data).lut;
    const again = addLut('Two', a.size, a.data).lut;
    expect(again.id).toBe(first.id);
    expect(first.id).toBe(lutId(a.size, a.data));
    const files = exportLutFiles([first.id]);
    expect(importLutFiles(files)).toBe(0); // already present
    expect(getLut(first.id)?.name).toBe('One');
    // tampered data must not be accepted under the wrong id
    const bad = { [first.id]: { ...files[first.id], data: toBase64(new Uint8Array(fromBase64(files[first.id].data).length)) } };
    expect(importLutFiles(bad)).toBe(0);
  });
});
