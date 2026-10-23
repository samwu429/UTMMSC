import { describe, expect, it } from 'vitest';
import { isOutdated, parseRelease } from './appUpdate';

describe('parseRelease', () => {
  it('accepts a well-formed release', () => {
    expect(parseRelease({ versionCode: 2, versionName: '1.1.0', sha256: 'x' })).toEqual({ versionCode: 2, versionName: '1.1.0' });
  });

  it('rejects anything else', () => {
    expect(parseRelease(null)).toBeNull();
    expect(parseRelease({ versionCode: '2', versionName: '1.1.0' })).toBeNull();
    expect(parseRelease({ versionCode: 0, versionName: '1.1.0' })).toBeNull();
    expect(parseRelease({ versionCode: 2.5, versionName: '1.1.0' })).toBeNull();
    expect(parseRelease({ versionCode: 2, versionName: '' })).toBeNull();
  });
});

describe('isOutdated', () => {
  const latest = { versionCode: 2, versionName: '1.1.0' };

  it('offers an update only to older builds', () => {
    expect(isOutdated('1', latest)).toBe(true);
    expect(isOutdated('2', latest)).toBe(false);
    expect(isOutdated('3', latest)).toBe(false);
  });

  it('never treats an unreadable build as outdated', () => {
    expect(isOutdated('', latest)).toBe(false);
    expect(isOutdated('1.0.0', latest)).toBe(false);
    expect(isOutdated('abc', latest)).toBe(false);
  });
});
