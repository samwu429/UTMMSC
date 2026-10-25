import { describe, expect, it } from 'vitest';
import { UPDATE_RELOAD_FLAG, type FlagStorage } from './pwa';
import { filmSkipped } from './SplashScreen';

function storage(flagged: boolean): FlagStorage & { items: Map<string, string> } {
  const items = new Map<string, string>(flagged ? [[UPDATE_RELOAD_FLAG, '1']] : []);
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
}

describe('filmSkipped', () => {
  it('plays the film on an ordinary launch', () => {
    expect(filmSkipped(storage(false), () => false)).toBe(false);
    expect(filmSkipped(null, () => false)).toBe(false);
  });

  it('skips it on the reload after an update, and only that once', () => {
    const flagged = storage(true);
    expect(filmSkipped(flagged, () => false)).toBe(true);
    expect(flagged.items.size).toBe(0);
    expect(filmSkipped(flagged, () => false)).toBe(false);
  });

  it('skips it under reduced motion, still consuming the update flag', () => {
    const flagged = storage(true);
    expect(filmSkipped(flagged, () => true)).toBe(true);
    expect(flagged.items.size).toBe(0);
    expect(filmSkipped(storage(false), () => true)).toBe(true);
  });

  it('plays it when the motion preference cannot be read', () => {
    expect(
      filmSkipped(storage(false), () => {
        throw new Error('no matchMedia');
      }),
    ).toBe(false);
  });
});
