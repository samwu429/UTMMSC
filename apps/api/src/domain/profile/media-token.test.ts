import { describe, expect, it } from 'vitest';
import { issueProfileMediaToken, profileMediaTokenExpiry, readProfileMediaToken } from './media-token';

const SECRET = 'test-secret';
const DAY = 24 * 60 * 60 * 1000;
const at = (iso: string) => Date.parse(iso);

describe('profileMediaTokenExpiry', () => {
  it('is the next UTC midnight plus seven days', () => {
    expect(profileMediaTokenExpiry(at('2026-10-24T00:00:00.000Z'))).toBe(at('2026-11-01T00:00:00.000Z'));
    expect(profileMediaTokenExpiry(at('2026-10-24T13:45:10.123Z'))).toBe(at('2026-11-01T00:00:00.000Z'));
    expect(profileMediaTokenExpiry(at('2026-10-24T23:59:59.999Z'))).toBe(at('2026-11-01T00:00:00.000Z'));
    expect(profileMediaTokenExpiry(at('2026-10-25T00:00:00.000Z'))).toBe(at('2026-11-02T00:00:00.000Z'));
  });

  it('never gives less than seven days', () => {
    for (const iso of ['2026-10-24T00:00:00.000Z', '2026-10-24T23:59:59.999Z', '2026-12-31T23:30:00.000Z']) {
      expect(profileMediaTokenExpiry(at(iso)) - at(iso)).toBeGreaterThan(7 * DAY);
    }
  });
});

describe('issueProfileMediaToken', () => {
  it('gives the same token for two issues on one UTC day', async () => {
    const morning = await issueProfileMediaToken(SECRET, at('2026-10-24T00:00:01.000Z'));
    const night = await issueProfileMediaToken(SECRET, at('2026-10-24T23:59:59.000Z'));
    expect(night).toBe(morning);
  });

  it('changes at UTC midnight', async () => {
    const before = await issueProfileMediaToken(SECRET, at('2026-10-24T23:59:59.999Z'));
    const after = await issueProfileMediaToken(SECRET, at('2026-10-25T00:00:00.000Z'));
    expect(after).not.toBe(before);
  });

  it('depends on the secret', async () => {
    const now = at('2026-10-24T12:00:00.000Z');
    expect(await issueProfileMediaToken('other-secret', now)).not.toBe(await issueProfileMediaToken(SECRET, now));
  });
});

describe('readProfileMediaToken', () => {
  it('accepts a token until its expiry and refuses it from then on', async () => {
    const issued = at('2026-10-24T12:00:00.000Z');
    const token = await issueProfileMediaToken(SECRET, issued);
    const expiry = at('2026-11-01T00:00:00.000Z');
    expect(await readProfileMediaToken(SECRET, token, issued)).toBe(true);
    expect(await readProfileMediaToken(SECRET, token, expiry - 1)).toBe(true);
    expect(await readProfileMediaToken(SECRET, token, expiry)).toBe(false);
  });

  it('refuses another secret, a tampered token and garbage', async () => {
    const now = at('2026-10-24T12:00:00.000Z');
    const token = await issueProfileMediaToken(SECRET, now);
    expect(await readProfileMediaToken('other-secret', token, now)).toBe(false);
    expect(await readProfileMediaToken(SECRET, `${token.slice(0, -2)}xx`, now)).toBe(false);
    expect(await readProfileMediaToken(SECRET, 'not-a-token', now)).toBe(false);
    expect(await readProfileMediaToken(SECRET, '', now)).toBe(false);
  });

  it('checks the current time by default', async () => {
    expect(await readProfileMediaToken(SECRET, await issueProfileMediaToken(SECRET))).toBe(true);
  });
});
