import { describe, expect, it } from 'vitest';
import { STICKER_PLAYING_MAX } from './media';
import { choosePlaying } from './playback';

const candidates = (...ranks: number[]) => ranks.map((rank, i) => ({ key: `k${i}`, rank }));

describe('choosePlaying', () => {
  it('lets the highest ranks play, at most max of them', () => {
    expect(choosePlaying(candidates(5, 9, 1, 7), 2)).toEqual(new Set(['k1', 'k3']));
    expect(choosePlaying(candidates(5, 9, 1, 7), 10)).toEqual(new Set(['k0', 'k1', 'k2', 'k3']));
  });

  it('keeps earlier candidates first among equal ranks', () => {
    expect(choosePlaying(candidates(3, 3, 3, 3), 2)).toEqual(new Set(['k0', 'k1']));
    expect(choosePlaying(candidates(1, 4, 4, 2), 2)).toEqual(new Set(['k1', 'k2']));
  });

  it('plays nothing with no room or no candidates', () => {
    expect(choosePlaying(candidates(1, 2), 0)).toEqual(new Set());
    expect(choosePlaying([], 8)).toEqual(new Set());
  });

  it('keeps a chat to 8 of the newest messages and a grid to 24 of the first tiles', () => {
    const chat = Array.from({ length: 30 }, (_, i) => ({ key: String(100 + i), rank: 100 + i }));
    const chosen = choosePlaying(chat, STICKER_PLAYING_MAX.chat);
    expect([...chosen].sort()).toEqual(['122', '123', '124', '125', '126', '127', '128', '129']);
    // The grid hook ranks by the negated index, so the first tiles win.
    // 表情格子的 hook 以序号取负作为名次，因此最靠前的格子优先。
    const grid = Array.from({ length: 40 }, (_, i) => ({ key: `t${i}`, rank: -i }));
    const playing = choosePlaying(grid, STICKER_PLAYING_MAX.grid);
    expect(playing.size).toBe(24);
    expect(playing.has('t0') && playing.has('t23') && !playing.has('t24')).toBe(true);
  });
});
