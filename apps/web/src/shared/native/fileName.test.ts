import { describe, expect, it } from 'vitest';
import { base64FromDataUrl, byteChunks, extensionForMime, safeFileName } from './fileName';

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

describe('extensionForMime', () => {
  it('maps common types', () => {
    expect(extensionForMime('image/jpeg')).toBe('jpg');
    expect(extensionForMime('image/png')).toBe('png');
    expect(extensionForMime('application/pdf')).toBe('pdf');
  });

  it('ignores case and parameters', () => {
    expect(extensionForMime('IMAGE/PNG')).toBe('png');
    expect(extensionForMime('text/plain; charset=utf-8')).toBe('txt');
  });

  it('returns null for unknown or missing types', () => {
    expect(extensionForMime('application/octet-stream')).toBeNull();
    expect(extensionForMime('')).toBeNull();
    expect(extensionForMime(undefined)).toBeNull();
    expect(extensionForMime(null)).toBeNull();
  });
});

describe('safeFileName', () => {
  it('keeps ordinary names, Chinese included', () => {
    expect(safeFileName('report.pdf')).toBe('report.pdf');
    expect(safeFileName('社团章程 2026.docx')).toBe('社团章程 2026.docx');
  });

  it('replaces path separators, reserved characters and control characters', () => {
    expect(safeFileName('a/b\\c:d*e?f"g<h>i|j#k%l.txt')).toBe('a_b_c_d_e_f_g_h_i_j_k_l.txt');
    expect(safeFileName('../../etc/passwd')).toBe('_.._etc_passwd');
    expect(safeFileName('name\u0000\u001f\u007f.txt')).toBe('name___.txt');
  });

  it('trims spaces and dots at either end', () => {
    expect(safeFileName('  ..notes.  ')).toBe('notes');
    expect(safeFileName('report.pdf.')).toBe('report.pdf');
  });

  it('adds an extension from the MIME type when the name has none', () => {
    expect(safeFileName('photo', 'image/jpeg')).toBe('photo.jpg');
    expect(safeFileName('v1.2 notes', 'application/pdf')).toBe('v1.2 notes.pdf');
    expect(safeFileName('photo.jpeg', 'image/png')).toBe('photo.jpeg');
    expect(safeFileName('photo', 'application/octet-stream')).toBe('photo');
  });

  it('falls back to a default name', () => {
    expect(safeFileName('')).toBe('download');
    expect(safeFileName('...')).toBe('download');
    expect(safeFileName('', 'image/png')).toBe('download.png');
    expect(safeFileName('.pdf')).toBe('pdf');
  });

  it('shortens long names by bytes and keeps the extension', () => {
    const latin = safeFileName(`${'a'.repeat(400)}.pdf`);
    expect(latin.endsWith('.pdf')).toBe(true);
    expect(utf8Length(latin)).toBeLessThanOrEqual(255);

    const chinese = safeFileName(`${'文'.repeat(200)}.xlsx`);
    expect(chinese.endsWith('.xlsx')).toBe(true);
    expect(utf8Length(chinese)).toBeLessThanOrEqual(255);
    expect(chinese.startsWith('文文文')).toBe(true);
  });

  it('never splits a character that needs two UTF-16 units', () => {
    const name = safeFileName(`${'𠀀'.repeat(100)}.png`);
    expect(name.endsWith('.png')).toBe(true);
    expect(name.replace('.png', '')).toMatch(/^(?:𠀀)+$/u);
    expect(utf8Length(name)).toBeLessThanOrEqual(255);
  });
});

describe('byteChunks', () => {
  it('splits a size into consecutive ranges', () => {
    expect(byteChunks(7, 3)).toEqual([
      { start: 0, end: 3 },
      { start: 3, end: 6 },
      { start: 6, end: 7 },
    ]);
    expect(byteChunks(6, 3)).toEqual([
      { start: 0, end: 3 },
      { start: 3, end: 6 },
    ]);
    expect(byteChunks(2, 3)).toEqual([{ start: 0, end: 2 }]);
  });

  it('still writes one empty piece for an empty file', () => {
    expect(byteChunks(0, 3)).toEqual([{ start: 0, end: 0 }]);
  });

  it('rejects a chunk size that would never finish', () => {
    expect(() => byteChunks(10, 0)).toThrow(RangeError);
    expect(() => byteChunks(10, Number.NaN)).toThrow(RangeError);
  });
});

describe('base64FromDataUrl', () => {
  it('returns the payload after the comma', () => {
    expect(base64FromDataUrl('data:image/png;base64,iVBORw0KGgo=')).toBe('iVBORw0KGgo=');
    expect(base64FromDataUrl('data:application/octet-stream;base64,')).toBe('');
  });

  it('returns an empty string when there is no payload', () => {
    expect(base64FromDataUrl('data:')).toBe('');
    expect(base64FromDataUrl('')).toBe('');
  });
});
