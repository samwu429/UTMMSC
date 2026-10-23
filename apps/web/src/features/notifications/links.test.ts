import { describe, expect, it } from 'vitest';
import { appPathFromUrl, roomIdFromPath } from './links';
import { base64UrlToBytes, sameKey } from './vapid';

describe('appPathFromUrl', () => {
  it('keeps only the path inside the app, so production links work on any host', () => {
    expect(appPathFromUrl('https://utmmsc.com/UTMMSC/chat/room/channel%3Ach_all')).toBe('/chat/room/channel%3Ach_all');
    expect(appPathFromUrl('http://localhost:5173/UTMMSC/settings')).toBe('/settings');
    expect(appPathFromUrl('https://utmmsc.com/UTMMSC/')).toBe('/');
    expect(appPathFromUrl('https://utmmsc.com/UTMMSC')).toBe('/');
    expect(appPathFromUrl('/UTMMSC/chat?tab=direct#top')).toBe('/chat?tab=direct#top');
  });

  it('refuses links outside the app', () => {
    expect(appPathFromUrl('https://utmmsc.com/download/android')).toBeNull();
    expect(appPathFromUrl('https://utmmsc.com/UTMMSCX/chat')).toBeNull();
    expect(appPathFromUrl('')).toBeNull();
    expect(appPathFromUrl(undefined)).toBeNull();
    expect(appPathFromUrl(42)).toBeNull();
  });
});

describe('roomIdFromPath', () => {
  it('reads the room of a conversation path', () => {
    expect(roomIdFromPath('/chat/room/channel%3Ach_all')).toBe('channel:ch_all');
    expect(roomIdFromPath('/chat/room/direct%3Adm_1?x=1')).toBe('direct:dm_1');
  });

  it('ignores the info page and other paths', () => {
    expect(roomIdFromPath('/chat/room/channel%3Ach_all/info')).toBeNull();
    expect(roomIdFromPath('/chat')).toBeNull();
    expect(roomIdFromPath('/chat/room/%E0%A4%A')).toBeNull();
  });
});

describe('VAPID key bytes', () => {
  const key = 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM';

  it('decodes a base64url public key into 65 bytes', () => {
    const bytes = base64UrlToBytes(key);
    expect(bytes.length).toBe(65);
    expect(bytes[0]).toBe(4);
  });

  it('matches a subscription made with the same key only', () => {
    const bytes = base64UrlToBytes(key);
    expect(sameKey(bytes.slice().buffer, bytes)).toBe(true);
    expect(sameKey(new DataView(bytes.slice().buffer), bytes)).toBe(true);
    const other = bytes.slice();
    other[10] = (other[10] ?? 0) ^ 1;
    expect(sameKey(other.buffer, bytes)).toBe(false);
    expect(sameKey(null, bytes)).toBe(false);
    expect(sameKey(new Uint8Array(3).buffer, bytes)).toBe(false);
  });
});
