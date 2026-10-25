import { describe, expect, it } from 'vitest';
import { signPayload } from '../crypto/hmac';
import {
  chatMediaTokenExpiry,
  issueChatMediaToken,
  issueProfileMediaToken,
  profileMediaTokenExpiry,
  readChatMediaToken,
  readProfileMediaToken,
} from './media-token';

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

describe('chatMediaTokenExpiry', () => {
  it('is the second UTC midnight after issue, so a token lives between one and two days', () => {
    expect(chatMediaTokenExpiry(at('2026-10-24T00:00:00.000Z'))).toBe(at('2026-10-26T00:00:00.000Z'));
    expect(chatMediaTokenExpiry(at('2026-10-24T13:45:10.123Z'))).toBe(at('2026-10-26T00:00:00.000Z'));
    expect(chatMediaTokenExpiry(at('2026-10-24T23:59:59.999Z'))).toBe(at('2026-10-26T00:00:00.000Z'));
    for (const iso of ['2026-10-24T00:00:00.000Z', '2026-10-24T23:59:59.999Z']) {
      const life = chatMediaTokenExpiry(at(iso)) - at(iso);
      expect(life).toBeGreaterThan(DAY);
      expect(life).toBeLessThanOrEqual(2 * DAY);
    }
  });
});

describe('issueChatMediaToken', () => {
  it('gives every ticket of one UTC day the same token for a room, so image URLs stay the same', async () => {
    const morning = await issueChatMediaToken(SECRET, 'channel:ch_all', at('2026-10-24T00:00:01.000Z'));
    const night = await issueChatMediaToken(SECRET, 'channel:ch_all', at('2026-10-24T23:59:59.000Z'));
    expect(night).toBe(morning);
    expect(await issueChatMediaToken(SECRET, 'channel:ch_all', at('2026-10-25T00:00:00.000Z'))).not.toBe(morning);
  });

  it('differs by room', async () => {
    const now = at('2026-10-24T12:00:00.000Z');
    expect(await issueChatMediaToken(SECRET, 'direct:dm_1', now)).not.toBe(await issueChatMediaToken(SECRET, 'channel:ch_all', now));
  });
});

describe('readChatMediaToken', () => {
  it('names the room until the token expires', async () => {
    const issued = at('2026-10-24T12:00:00.000Z');
    const token = await issueChatMediaToken(SECRET, 'direct:dm_1', issued);
    expect(await readChatMediaToken(SECRET, token, issued)).toBe('direct:dm_1');
    expect(await readChatMediaToken(SECRET, token, at('2026-10-26T00:00:00.000Z') - 1)).toBe('direct:dm_1');
    expect(await readChatMediaToken(SECRET, token, at('2026-10-26T00:00:00.000Z'))).toBeNull();
  });

  it('still accepts the hour-long tokens older servers issued', async () => {
    const now = at('2026-10-24T12:00:00.000Z');
    const old = await signPayload(SECRET, { kind: 'media', roomId: 'channel:ch_all', exp: now + 60 * 60 * 1000 });
    expect(await readChatMediaToken(SECRET, old, now)).toBe('channel:ch_all');
  });

  it('refuses a profile token, another secret, a token without a room and garbage', async () => {
    const now = at('2026-10-24T12:00:00.000Z');
    expect(await readChatMediaToken(SECRET, await issueProfileMediaToken(SECRET, now), now)).toBeNull();
    expect(await readChatMediaToken('other-secret', await issueChatMediaToken(SECRET, 'channel:ch_all', now), now)).toBeNull();
    expect(await readChatMediaToken(SECRET, await signPayload(SECRET, { kind: 'media', exp: now + DAY }), now)).toBeNull();
    expect(await readChatMediaToken(SECRET, 'not-a-token', now)).toBeNull();
    expect(await readChatMediaToken(SECRET, '', now)).toBeNull();
  });

  it('is not accepted as a profile media token', async () => {
    const now = at('2026-10-24T12:00:00.000Z');
    expect(await readProfileMediaToken(SECRET, await issueChatMediaToken(SECRET, 'channel:ch_all', now), now)).toBe(false);
  });
});
