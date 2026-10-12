import { describe, expect, it } from 'vitest';
import { findMiniApp, MINI_APPS } from './catalog';

describe('mini app catalog', () => {
  it('lists RUFREE as a recommended project', () => {
    expect(MINI_APPS.map((app) => app.id)).toContain('rufree');
    expect(findMiniApp('rufree')?.url).toBe('https://rufree.ca');
    expect(findMiniApp('missing')).toBeUndefined();
  });
});
