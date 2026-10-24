import { describe, expect, it } from 'vitest';
import { bytesToBase64Url, utf8ToBytes } from '../crypto/encoding';
import { compareMomentCursors, decodeMomentCursor, encodeMomentCursor, type MomentCursor } from './cursor';

function encodeRaw(value: unknown): string {
  return bytesToBase64Url(utf8ToBytes(JSON.stringify(value)));
}

describe('moment cursors', () => {
  it('round-trips a position as a url-safe string', () => {
    const cursor: MomentCursor = { at: '2026-10-24T08:15:30.123Z', id: 'post_Ab-c_9xYz012345' };
    const encoded = encodeMomentCursor(cursor);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeMomentCursor(encoded)).toEqual(cursor);
  });

  it('reads a missing value as no cursor', () => {
    expect(decodeMomentCursor(undefined)).toBeNull();
    expect(decodeMomentCursor(null)).toBeNull();
    expect(decodeMomentCursor('')).toBeNull();
  });

  it('refuses garbage', () => {
    for (const raw of ['not a cursor', '%%%', 'abc=', 'a', '....', 'x'.repeat(500)]) {
      expect(decodeMomentCursor(raw)).toBeNull();
    }
    expect(decodeMomentCursor(bytesToBase64Url(utf8ToBytes('{"at":1')))).toBeNull();
    expect(decodeMomentCursor(bytesToBase64Url(new Uint8Array([0xff, 0xfe, 0x00, 0x01])))).toBeNull();
  });

  it('refuses a tampered cursor whose fields are no longer a position', () => {
    const at = '2026-10-24T08:15:30.123Z';
    expect(decodeMomentCursor(encodeRaw({ at, id: 'post_1' }))).toBeNull();
    expect(decodeMomentCursor(encodeRaw([at]))).toBeNull();
    expect(decodeMomentCursor(encodeRaw([at, 'post_1', 'extra']))).toBeNull();
    expect(decodeMomentCursor(encodeRaw([at, 42]))).toBeNull();
    expect(decodeMomentCursor(encodeRaw([at, '']))).toBeNull();
    expect(decodeMomentCursor(encodeRaw([at, "post' OR 1=1 --"]))).toBeNull();
    expect(decodeMomentCursor(encodeRaw([at, 'p'.repeat(101)]))).toBeNull();
    expect(decodeMomentCursor(encodeRaw(['2026-10-24', 'post_1']))).toBeNull();
    expect(decodeMomentCursor(encodeRaw(['2026-02-30T00:00:00.000Z', 'post_1']))).toBeNull();
    expect(decodeMomentCursor(encodeRaw(['2026-10-24T08:15:30Z', 'post_1']))).toBeNull();
    expect(decodeMomentCursor(encodeRaw(['2026-10-24T08:15:30.123+08:00', 'post_1']))).toBeNull();
    const encoded = encodeMomentCursor({ at, id: 'post_1' });
    const flipped = `${encoded.slice(0, 3)}${encoded[3] === 'A' ? 'B' : 'A'}${encoded.slice(4)}`;
    expect(decodeMomentCursor(flipped)).toBeNull();
  });

  it('orders by time, then by id for the same timestamp', () => {
    const at = '2026-10-24T08:15:30.123Z';
    const a = { at, id: 'post_a' };
    const b = { at, id: 'post_b' };
    const later = { at: '2026-10-24T08:15:30.124Z', id: 'post_0' };
    expect(compareMomentCursors(a, b)).toBeLessThan(0);
    expect(compareMomentCursors(b, a)).toBeGreaterThan(0);
    expect(compareMomentCursors(a, { ...a })).toBe(0);
    expect(compareMomentCursors(b, later)).toBeLessThan(0);
    const newestFirst = [a, later, b].sort((x, y) => -compareMomentCursors(x, y));
    expect(newestFirst).toEqual([later, b, a]);
  });

  it('compares ids the way SQLite compares text, by code unit and not by locale', () => {
    expect(compareMomentCursors({ at: 'x', id: 'post_Z' }, { at: 'x', id: 'post_a' })).toBeLessThan(0);
    expect(compareMomentCursors({ at: 'x', id: 'post_-' }, { at: 'x', id: 'post_0' })).toBeLessThan(0);
  });
});
