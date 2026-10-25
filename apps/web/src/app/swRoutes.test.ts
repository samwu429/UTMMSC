import { describe, expect, it } from 'vitest';
import { isMediaImageRequest, isPresetAvatarRequest, mediaCacheKey } from './swRoutes';

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
    expect(media(request('https://utmmsc.com/api/members/media/a.jpg?t=x'))).toBe(true);
    expect(preset({ ...request('https://utmmsc.com/UTMMSC/avatars/a-128.webp'), sameOrigin: true })).toBe(true);
    expect(await cacheKey({ request: { url: 'https://utmmsc.com/api/members/media/a.jpg?t=x' } as Request })).toBe(
      'https://utmmsc.com/api/members/media/a.jpg',
    );
  });
});
