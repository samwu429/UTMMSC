import { describe, expect, it } from 'vitest';
import {
  isMediaImageRequest,
  isPresetAvatarRequest,
  isStickerFileRequest,
  isStickerThumbRequest,
  mediaCacheKey,
  skipLargeStickerResponses,
} from './swRoutes';

const request = (url: string, destination = 'image') => ({ url: new URL(url), request: { url, destination } as Request });

describe('isMediaImageRequest', () => {
  it('matches media images on the same-origin API and on the Worker address', () => {
    expect(isMediaImageRequest(request('https://utmmsc.com/api/members/media/avatar%2Fm_1%2Fa.jpg?t=x'))).toBe(true);
    expect(isMediaImageRequest(request('https://utmmsc.com/api/chat/media/room%2Fch_all%2Fp.jpg?t=x&v=thumb'))).toBe(true);
    expect(isMediaImageRequest(request('https://utmmsc-api.utmmsc.workers.dev/members/media/cover%2Fm_1%2Fc.jpg?t=x'))).toBe(true);
  });

  it('leaves videos, other requests and other paths to the network', () => {
    expect(isMediaImageRequest(request('https://utmmsc.com/api/members/media/moment%2Fv.mp4?t=x', 'video'))).toBe(false);
    expect(isMediaImageRequest(request('https://utmmsc.com/api/members/media/a.jpg?t=x', ''))).toBe(false);
    expect(isMediaImageRequest(request('https://utmmsc.com/api/members/me'))).toBe(false);
    expect(isMediaImageRequest(request('https://utmmsc.com/UTMMSC/avatars/man-cool-gold-128.webp'))).toBe(false);
  });
});

describe('mediaCacheKey', () => {
  it('drops the daily token and the retry counter, and keeps everything else', async () => {
    const key = (url: string) => mediaCacheKey({ request: { url } as Request });
    const today = await key('https://utmmsc.com/api/chat/media/room%2Fp.jpg?t=day1&v=thumb');
    const tomorrow = await key('https://utmmsc.com/api/chat/media/room%2Fp.jpg?t=day2&v=thumb&retry=2');
    expect(today).toBe('https://utmmsc.com/api/chat/media/room%2Fp.jpg?v=thumb');
    expect(tomorrow).toBe(today);
    expect(await key('https://utmmsc.com/api/chat/media/room%2Fp.jpg?t=day1')).toBe('https://utmmsc.com/api/chat/media/room%2Fp.jpg');
  });
});

const STICKER_ID = `stk_${'Ab0_-'.repeat(4)}xy`;
const THUMB = `${'Zz9-_'.repeat(4)}qq`;

describe('sticker requests', () => {
  it('match a sticker still with the slash encoded or not, on either API address', () => {
    expect(isStickerThumbRequest(request(`https://utmmsc.com/api/members/media/sticker%2F${STICKER_ID}-t-${THUMB}?t=x`))).toBe(true);
    expect(isStickerThumbRequest(request(`https://utmmsc.com/api/members/media/sticker%2f${STICKER_ID}-t-${THUMB}?t=x&retry=1`))).toBe(true);
    expect(isStickerThumbRequest(request(`https://utmmsc-api.utmmsc.workers.dev/members/media/sticker/${STICKER_ID}-t-${THUMB}`))).toBe(true);
    expect(isStickerFileRequest(request(`https://utmmsc.com/api/members/media/sticker%2F${STICKER_ID}-t-${THUMB}?t=x`))).toBe(false);
  });

  it('match a sticker file of each type', () => {
    for (const type of ['gif', 'png', 'webp', 'jpeg']) {
      expect(isStickerFileRequest(request(`https://utmmsc.com/api/members/media/sticker%2F${STICKER_ID}.${type}?t=x`))).toBe(true);
    }
    expect(isStickerFileRequest(request(`https://utmmsc-api.utmmsc.workers.dev/members/media/sticker/${STICKER_ID}.gif`))).toBe(true);
    expect(isStickerThumbRequest(request(`https://utmmsc.com/api/members/media/sticker%2F${STICKER_ID}.gif?t=x`))).toBe(false);
  });

  it('refuse look-alikes, the old -thumb form, other routes and other destinations', () => {
    const refused = [
      `https://utmmsc.com/api/members/media/sticker%2F${STICKER_ID}-thumb?t=x`,
      `https://utmmsc.com/api/members/media/sticker%2F${STICKER_ID}.jpg?t=x`,
      `https://utmmsc.com/api/members/media/sticker%2F${STICKER_ID}.svg?t=x`,
      `https://utmmsc.com/api/members/media/sticker%2Fstk_short.gif?t=x`,
      `https://utmmsc.com/api/members/media/sticker%2F${STICKER_ID}x.gif?t=x`,
      `https://utmmsc.com/api/members/media/sticker%2F${STICKER_ID}.gif%2F..%2Fa.gif?t=x`,
      `https://utmmsc.com/api/members/media/avatar%2Fsticker%2F${STICKER_ID}.gif?t=x`,
      `https://utmmsc.com/api/chat/media/sticker%2F${STICKER_ID}.gif?t=x`,
      `https://utmmsc.com/api/chat/media/chat%2Fchannel%2Fabc%2F${STICKER_ID}.gif?t=x`,
      `https://utmmsc.com/api/members/media/sticker%2F${STICKER_ID}-t-short?t=x`,
    ];
    for (const url of refused) {
      expect(isStickerFileRequest(request(url))).toBe(false);
      expect(isStickerThumbRequest(request(url))).toBe(false);
    }
    expect(isStickerFileRequest(request(`https://utmmsc.com/api/members/media/sticker%2F${STICKER_ID}.gif?t=x`, ''))).toBe(false);
    expect(isStickerThumbRequest(request(`https://utmmsc.com/api/members/media/sticker%2F${STICKER_ID}-t-${THUMB}?t=x`, 'video'))).toBe(false);
  });

  it('leave the general media rule matching stickers and every other key, so the order in vite.config.ts decides', () => {
    expect(isMediaImageRequest(request(`https://utmmsc.com/api/members/media/sticker%2F${STICKER_ID}.gif?t=x`))).toBe(true);
    expect(isMediaImageRequest(request('https://utmmsc.com/api/members/media/avatar%2Fm_1%2Fa.jpg?t=x'))).toBe(true);
    expect(isMediaImageRequest(request('https://utmmsc.com/api/chat/media/chat%2Fchannel%2Fabc%2Fimg_0123456789abcdef.jpeg?t=x'))).toBe(true);
  });
});

describe('skipLargeStickerResponses', () => {
  const sized = (bytes: number | null) => new Response('x', { headers: bytes === null ? {} : { 'content-length': String(bytes) } });

  it('drops a response over 2 MiB and keeps a smaller one or one without a length', async () => {
    expect(await skipLargeStickerResponses({ response: sized(3 * 1024 * 1024) })).toBeNull();
    const small = sized(1024 * 1024);
    expect(await skipLargeStickerResponses({ response: small })).toBe(small);
    const edge = sized(2 * 1024 * 1024);
    expect(await skipLargeStickerResponses({ response: edge })).toBe(edge);
    const unknown = sized(null);
    expect(await skipLargeStickerResponses({ response: unknown })).toBe(unknown);
  });
});

describe('isPresetAvatarRequest', () => {
  const avatar = (url: string, sameOrigin = true, destination = 'image') => ({ ...request(url, destination), sameOrigin });

  it('matches this app\'s WebP preset avatars', () => {
    expect(isPresetAvatarRequest(avatar('https://utmmsc.com/UTMMSC/avatars/man-cool-gold-256.webp'))).toBe(true);
  });

  it('leaves the old GIF and PNG files, other origins and other folders alone', () => {
    expect(isPresetAvatarRequest(avatar('https://utmmsc.com/UTMMSC/avatars/man-cool-gold.gif'))).toBe(false);
    expect(isPresetAvatarRequest(avatar('https://utmmsc.com/UTMMSC/avatars/man-cool-gold.png'))).toBe(false);
    expect(isPresetAvatarRequest(avatar('https://example.test/UTMMSC/avatars/x.webp', false))).toBe(false);
    expect(isPresetAvatarRequest(avatar('https://utmmsc.com/UTMMSC/brand/x.webp'))).toBe(false);
    expect(isPresetAvatarRequest(avatar('https://utmmsc.com/UTMMSC/avatars/x.webp', true, 'document'))).toBe(false);
  });
});

describe('service worker rules', () => {
  it('work from their source text alone, as Workbox copies them into sw.js', async () => {
    // A rule that leaned on an import or a constant of this file would throw here, in an empty scope.
    // 依赖导入或本文件常量的规则在这个空作用域里会抛错。
    const revive = <T>(fn: T): T => new Function(`return (${String(fn)});`)() as T;
    const media = revive(isMediaImageRequest);
    const preset = revive(isPresetAvatarRequest);
    const cacheKey = revive(mediaCacheKey);
    const thumb = revive(isStickerThumbRequest);
    const file = revive(isStickerFileRequest);
    const skip = revive(skipLargeStickerResponses);
    expect(thumb(request(`https://utmmsc.com/api/members/media/sticker%2F${STICKER_ID}-t-${THUMB}?t=x`))).toBe(true);
    expect(file(request(`https://utmmsc.com/api/members/media/sticker%2F${STICKER_ID}.webp?t=x`))).toBe(true);
    expect(await skip({ response: new Response('x', { headers: { 'content-length': String(5 * 1024 * 1024) } }) })).toBeNull();
    expect(media(request('https://utmmsc.com/api/members/media/a.jpg?t=x'))).toBe(true);
    expect(preset({ ...request('https://utmmsc.com/UTMMSC/avatars/a-128.webp'), sameOrigin: true })).toBe(true);
    expect(await cacheKey({ request: { url: 'https://utmmsc.com/api/members/media/a.jpg?t=x' } as Request })).toBe(
      'https://utmmsc.com/api/members/media/a.jpg',
    );
  });
});
