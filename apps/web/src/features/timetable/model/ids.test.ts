import { describe, expect, it } from 'vitest';
import { isTimetableId } from '@utmmsc/shared';
import { newTimetableId } from './ids';

describe('newTimetableId', () => {
  it('makes ids the API accepts, of the kind asked for', () => {
    for (const prefix of ['tt', 'tc', 'tm', 'ta'] as const) {
      for (let i = 0; i < 50; i += 1) {
        const id = newTimetableId(prefix);
        expect(isTimetableId(id, prefix)).toBe(true);
      }
    }
  });

  it('does not repeat', () => {
    const ids = new Set(Array.from({ length: 2000 }, () => newTimetableId('tc')));
    expect(ids.size).toBe(2000);
  });

  it('uses every position of the alphabet over many ids', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 400; i += 1) for (const ch of newTimetableId('ta').slice(3, 24)) seen.add(ch);
    expect(seen.size).toBe(64);
  });
});
