import { describe, expect, it } from 'vitest';
import { channelIconKeyOf, channelIconNeedsToken, channelIconPushUrl } from './icon';

const UPLOAD = 'channel-icon/ch_all/cic_abcdefghijklmnop.webp';
const API = 'https://utmmsc.com/api';
const APP = 'https://utmmsc.com/UTMMSC/';

describe('channelIconKeyOf', () => {
  it('reads an upload or a known preset from the row', () => {
    expect(channelIconKeyOf({ icon_key: UPLOAD })).toBe(UPLOAD);
    expect(channelIconKeyOf({ icon_key: 'preset:events' })).toBe('preset:events');
  });

  it('is null without an icon and for a row from before migration 0018', () => {
    expect(channelIconKeyOf({ icon_key: null })).toBeNull();
    expect(channelIconKeyOf({})).toBeNull();
  });

  it('is null for a value the app could not show', () => {
    for (const bad of ['preset:unknown', 'avatar/mem_1/x.jpg', 'channel-icon/ch_all/cic_abcdefghijklmnop-96.webp', 'channel-icon/../x.webp', '', 42]) {
      expect(channelIconKeyOf({ icon_key: bad })).toBeNull();
    }
  });
});

describe('channelIconNeedsToken', () => {
  it('is true only for uploads', () => {
    expect(channelIconNeedsToken(UPLOAD)).toBe(true);
    expect(channelIconNeedsToken('preset:chat')).toBe(false);
    expect(channelIconNeedsToken(null)).toBe(false);
    expect(channelIconNeedsToken(undefined)).toBe(false);
  });
});

describe('channelIconPushUrl', () => {
  it('serves an upload from the API with the token, as the app builds it', () => {
    expect(channelIconPushUrl({ iconKey: UPLOAD, apiBase: API, appBase: APP, token: 'a.b+c' })).toBe(
      'https://utmmsc.com/api/members/media/channel-icon%2Fch_all%2Fcic_abcdefghijklmnop.webp?t=a.b%2Bc',
    );
  });

  it('accepts an API base with a trailing slash', () => {
    expect(channelIconPushUrl({ iconKey: UPLOAD, apiBase: `${API}/`, appBase: APP, token: 't' })).toBe(
      'https://utmmsc.com/api/members/media/channel-icon%2Fch_all%2Fcic_abcdefghijklmnop.webp?t=t',
    );
  });

  it('serves a preset as the 192 px PNG published with the app, without a token', () => {
    expect(channelIconPushUrl({ iconKey: 'preset:announce', apiBase: null, appBase: APP, token: null })).toBe(
      'https://utmmsc.com/UTMMSC/channel-icons/announce-192.png',
    );
    expect(channelIconPushUrl({ iconKey: 'preset:alumni', apiBase: API, appBase: 'https://utmmsc.com/UTMMSC', token: null })).toBe(
      'https://utmmsc.com/UTMMSC/channel-icons/alumni-192.png',
    );
  });

  it('leaves an upload out without an API address or a token', () => {
    expect(channelIconPushUrl({ iconKey: UPLOAD, apiBase: undefined, appBase: APP, token: 't' })).toBeUndefined();
    expect(channelIconPushUrl({ iconKey: UPLOAD, apiBase: '', appBase: APP, token: 't' })).toBeUndefined();
    expect(channelIconPushUrl({ iconKey: UPLOAD, apiBase: API, appBase: APP, token: null })).toBeUndefined();
  });

  it('is undefined without an icon, for an unknown key, and for any address that is not https', () => {
    expect(channelIconPushUrl({ iconKey: null, apiBase: API, appBase: APP, token: 't' })).toBeUndefined();
    expect(channelIconPushUrl({ iconKey: 'preset:unknown', apiBase: API, appBase: APP, token: 't' })).toBeUndefined();
    expect(channelIconPushUrl({ iconKey: 'avatar/mem_1/x.jpg', apiBase: API, appBase: APP, token: 't' })).toBeUndefined();
    expect(channelIconPushUrl({ iconKey: UPLOAD, apiBase: 'http://localhost:8787', appBase: APP, token: 't' })).toBeUndefined();
    expect(channelIconPushUrl({ iconKey: 'preset:chat', apiBase: API, appBase: 'http://localhost:5173/UTMMSC/', token: null })).toBeUndefined();
  });
});
