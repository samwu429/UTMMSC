import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CHANNEL_ICON_PRESETS, channelIconPresetKey } from '@utmmsc/shared';
import { mediaUrl } from '../../profile/media';

// Server rendering reads a zustand store's initial state, so the session is a plain object the test sets.
// 服务端渲染读取的是 zustand store 的初始状态，因此会话改用测试自己设置的普通对象。
const session = vi.hoisted(() => ({ mediaToken: null as string | null }));
vi.mock('../../../shared/session/store', () => ({
  useSessionStore: Object.assign((select: (state: typeof session) => unknown) => select(session), {
    getState: () => session,
    subscribe: () => () => undefined,
  }),
}));

// The web workspace has no Node types, so fs is loaded by name; the tests themselves run in Node.
// Web 工作区没有 Node 类型，所以按名称加载 fs；测试本身在 Node 中运行。
const FS = 'node:fs';
const { readFileSync } = (await import(/* @vite-ignore */ FS)) as { readFileSync: (path: URL) => Uint8Array };

const { channelIconSrc, presetChannelIconUrl } = await import('./channelIconSrc');
const { ChannelIcon } = await import('./ChannelIcon');
const { ChatAvatar } = await import('./ChatAvatar');

const BASE = import.meta.env.BASE_URL;
const UPLOAD = 'channel-icon/ch_study/cic_AbCdEfGhIjKlMnOp.webp';
const UPLOAD_THUMB = 'channel-icon/ch_study/cic_AbCdEfGhIjKlMnOp-96.webp';
const JPEG = 'channel-icon/ch_study/cic_0123456789abcdef.jpg';

beforeEach(() => {
  session.mediaToken = null;
});

describe('channelIconSrc', () => {
  it('uses the bundled SVG for every preset, with no token and no srcset', () => {
    for (const preset of CHANNEL_ICON_PRESETS) {
      expect(channelIconSrc(channelIconPresetKey(preset.id), null)).toEqual({ src: `${BASE}channel-icons/${preset.id}.svg`, srcSet: null });
    }
    expect(presetChannelIconUrl('events', '/UTMMSC/')).toBe('/UTMMSC/channel-icons/events.svg');
    expect(channelIconSrc('preset:alumni', 'tok', '/UTMMSC/')).toEqual({ src: '/UTMMSC/channel-icons/alumni.svg', srcSet: null });
  });

  it('offers the 96 px thumbnail and the 256 px image of an upload, so the screen density picks one', () => {
    expect(channelIconSrc(UPLOAD, 'tok')).toEqual({
      src: mediaUrl(UPLOAD, 'tok'),
      srcSet: `${mediaUrl(UPLOAD_THUMB, 'tok')} 96w, ${mediaUrl(UPLOAD, 'tok')} 256w`,
    });
    expect(channelIconSrc(JPEG, 'tok')?.srcSet).toBe(`${mediaUrl('channel-icon/ch_study/cic_0123456789abcdef-96.jpg', 'tok')} 96w, ${mediaUrl(JPEG, 'tok')} 256w`);
    expect(decodeURIComponent(channelIconSrc(UPLOAD, 'a b')?.src ?? '')).toContain(`/members/media/${UPLOAD}?t=a b`);
  });

  it('keeps the text tile for an upload until the session has a media token', () => {
    expect(channelIconSrc(UPLOAD, null)).toBeNull();
    expect(channelIconSrc(UPLOAD, undefined)).toBeNull();
    expect(channelIconSrc(UPLOAD, '')).toBeNull();
  });

  it('keeps the text tile for no icon, an unknown preset or a key that is not an upload', () => {
    for (const key of [null, undefined, '', 'preset:', 'preset:nope', 'Preset:events', UPLOAD_THUMB, 'channel-icon/ch/../cic_AbCdEfGhIjKlMnOp.webp', 'channel-icon/ch/cic_short.webp', 'channel-icon/ch/cic_AbCdEfGhIjKlMnOp.png', 'avatar/mem_a/x.jpg']) {
      expect(channelIconSrc(key, 'tok')).toBeNull();
    }
  });
});

const images = (html: string) => [...html.matchAll(/<img [^>]*>/g)].map((match) => match[0]);
// HTML attribute names ignore case; React writes srcSet as is.
// HTML 属性名不区分大小写；React 原样写出 srcSet。
const attribute = (tag: string, name: string) => new RegExp(` ${name}="([^"]*)"`, 'i').exec(tag)?.[1] ?? null;

describe('ChannelIcon', () => {
  it('always draws the text tile, and the preset over it at a fixed size', () => {
    const html = renderToStaticMarkup(createElement(ChannelIcon, { name: '  学术交流', iconKey: 'preset:academic' }));
    expect(html).toContain('bg-brand-700');
    expect(html).toContain('>学');
    const [img] = images(html);
    expect(img).toBeDefined();
    expect(attribute(img ?? '', 'src')).toBe(`${BASE}channel-icons/academic.svg`);
    expect(attribute(img ?? '', 'srcset')).toBeNull();
    expect(attribute(img ?? '', 'width')).toBe('48');
    expect(attribute(img ?? '', 'height')).toBe('48');
    expect(attribute(img ?? '', 'alt')).toBe('');
    expect(attribute(img ?? '', 'loading')).toBe('lazy');
    expect(attribute(img ?? '', 'decoding')).toBe('async');
    expect(attribute(img ?? '', 'draggable')).toBe('false');
  });

  it('asks for the upload at the size it is drawn, once there is a media token', () => {
    expect(images(renderToStaticMarkup(createElement(ChannelIcon, { name: 'Study', iconKey: UPLOAD })))).toEqual([]);
    session.mediaToken = 'tok';
    const [img] = images(renderToStaticMarkup(createElement(ChannelIcon, { name: 'Study', iconKey: UPLOAD, size: 64 })));
    expect(attribute(img ?? '', 'sizes')).toBe('64px');
    expect(attribute(img ?? '', 'width')).toBe('64');
    expect(decodeURIComponent(attribute(img ?? '', 'srcset') ?? '')).toContain(`${UPLOAD_THUMB}?t=tok 96w`);
  });

  it('shows only the tile for a channel without an icon, keeping a whole emoji as the initial', () => {
    const wave = String.fromCodePoint(0x1f44b);
    const html = renderToStaticMarkup(createElement(ChannelIcon, { name: `${wave}Hi`, iconKey: null, size: 72 }));
    expect(images(html)).toEqual([]);
    expect(html).toContain(`>${wave}</div>`);
    expect(html).toContain('h-[72px]');
  });

  it('is drawn by ChatAvatar for channels, at the size the list asks for', () => {
    session.mediaToken = 'tok';
    const html = renderToStaticMarkup(createElement(ChatAvatar, { avatar: { kind: 'channel', name: 'Study', iconKey: UPLOAD }, size: 40 }));
    expect(html).toContain('h-10 w-10');
    expect(attribute(images(html)[0] ?? '', 'sizes')).toBe('40px');
    const direct = renderToStaticMarkup(createElement(ChatAvatar, { avatar: { kind: 'direct', name: 'Peer', avatarKey: null } }));
    expect(direct).not.toContain('bg-brand-700');
    expect(direct).toContain('>P</div>');
  });
});

/** Width and height from a PNG's IHDR chunk. */
/** 从 PNG 的 IHDR 块读出宽和高。 */
function pngSize(bytes: Uint8Array): { width: number; height: number } {
  expect(String.fromCharCode(...bytes.subarray(1, 4))).toBe('PNG');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

describe('preset files', () => {
  const file = (name: string) => new URL(`../../../../public/channel-icons/${name}`, import.meta.url);

  it('ships a small square SVG for every preset, which the precache picks up', () => {
    for (const preset of CHANNEL_ICON_PRESETS) {
      const svg = new TextDecoder().decode(readFileSync(file(`${preset.id}.svg`)));
      expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"')).toBe(true);
      expect(svg.length).toBeLessThan(2048);
      expect(svg).not.toMatch(/<script|href=|url\(/i);
    }
  });

  it('ships a 192 px PNG of every preset for Web Push, which cannot draw SVG icons everywhere', () => {
    for (const preset of CHANNEL_ICON_PRESETS) {
      const bytes = readFileSync(file(`${preset.id}-192.png`));
      expect(pngSize(bytes)).toEqual({ width: 192, height: 192 });
      expect(bytes.length).toBeLessThan(16 * 1024);
    }
  });
});
