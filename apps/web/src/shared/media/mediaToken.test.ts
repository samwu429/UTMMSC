import { describe, expect, it } from 'vitest';
import {
  MEDIA_REFRESH_FALLBACK_MS,
  MEDIA_REFRESH_LEAD_MS,
  MEDIA_REFRESH_MAX_MS,
  MEDIA_REFRESH_MIN_MS,
  mediaRefreshDelay,
  mediaTokenExpiry,
} from './mediaToken';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 9, 24, 15, 0, 0);

/** Signs nothing; the page never checks the signature, only the server does. */
/** 不做签名；页面从不检查签名，只有服务端检查。 */
function base64Url(text: string): string {
  const binary = Array.from(new TextEncoder().encode(text), (byte) => String.fromCharCode(byte)).join('');
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function token(payload: unknown): string {
  return `${base64Url(JSON.stringify(payload))}.c2lnbmF0dXJl`;
}

describe('mediaTokenExpiry', () => {
  it('reads exp from the payload', () => {
    expect(mediaTokenExpiry(token({ kind: 'media', roomId: 'channel:ch_all', exp: NOW + DAY }))).toBe(NOW + DAY);
  });

  it('reads payloads whose base64url needs padding or uses - and _', () => {
    const exp = NOW + 7;
    for (const roomId of ['a', 'ab', 'abc', '??>>', 'ÿþ']) expect(mediaTokenExpiry(token({ roomId, exp }))).toBe(exp);
  });

  it('gives null for anything it cannot read', () => {
    expect(mediaTokenExpiry(null)).toBeNull();
    expect(mediaTokenExpiry('')).toBeNull();
    expect(mediaTokenExpiry('no-dot')).toBeNull();
    expect(mediaTokenExpiry('.sig')).toBeNull();
    expect(mediaTokenExpiry('%%%.sig')).toBeNull();
    expect(mediaTokenExpiry(`${base64Url('not json')}.sig`)).toBeNull();
    expect(mediaTokenExpiry(token({ exp: 'soon' }))).toBeNull();
    expect(mediaTokenExpiry(token(null))).toBeNull();
    expect(mediaTokenExpiry(token([1, 2]))).toBeNull();
  });
});

describe('mediaRefreshDelay', () => {
  it('replaces an hour-long token ten minutes before it ends', () => {
    expect(mediaRefreshDelay(token({ exp: NOW + HOUR }), NOW)).toBe(HOUR - MEDIA_REFRESH_LEAD_MS);
  });

  it('checks a day token at most every 12 hours, so a new day brings the new token in time', () => {
    expect(mediaRefreshDelay(token({ exp: NOW + 2 * DAY }), NOW)).toBe(MEDIA_REFRESH_MAX_MS);
  });

  it('allows for the server clock', () => {
    // The server is 5 minutes ahead, so the token ends 5 minutes sooner on this device.
    // 服务器快 5 分钟，因此在本设备上令牌提前 5 分钟结束。
    expect(mediaRefreshDelay(token({ exp: NOW + HOUR }), NOW, 5 * 60 * 1000)).toBe(HOUR - MEDIA_REFRESH_LEAD_MS - 5 * 60 * 1000);
  });

  it('never loops on an expired token or a far-off clock', () => {
    expect(mediaRefreshDelay(token({ exp: NOW - HOUR }), NOW)).toBe(MEDIA_REFRESH_MIN_MS);
    expect(mediaRefreshDelay(token({ exp: NOW + HOUR }), NOW, 10 * HOUR)).toBe(MEDIA_REFRESH_MIN_MS);
  });

  it('keeps the old rhythm for a token it cannot read', () => {
    expect(mediaRefreshDelay('opaque', NOW)).toBe(MEDIA_REFRESH_FALLBACK_MS);
    expect(mediaRefreshDelay(null, NOW)).toBe(MEDIA_REFRESH_FALLBACK_MS);
  });
});
