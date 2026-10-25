import { describe, expect, it } from 'vitest';
import { IMMUTABLE, REVALIDATE, STATIC_DAY, memberCacheControl, withCacheControl } from './cache';

describe('memberCacheControl', () => {
  it('caches hashed build files for a year', () => {
    expect(memberCacheControl('/UTMMSC/assets/index-BNk_S1Z7.js')).toBe(IMMUTABLE);
    expect(memberCacheControl('/UTMMSC/assets/index-CRPb-l65.css')).toBe(IMMUTABLE);
    expect(memberCacheControl('/UTMMSC/workbox-2fbc6a65.js')).toBe(IMMUTABLE);
  });

  it('revalidates the files that decide the build', () => {
    for (const file of ['', 'index.html', 'sw.js', 'push-sw.js', 'manifest.webmanifest', 'registerSW.js']) {
      expect(memberCacheControl(`/UTMMSC/${file}`)).toBe(REVALIDATE);
    }
  });

  it('keeps stable-named static files for a day', () => {
    expect(memberCacheControl('/UTMMSC/avatars/man-cool-gold-128.webp')).toBe(STATIC_DAY);
    expect(memberCacheControl('/UTMMSC/splash/open.mp4')).toBe(STATIC_DAY);
    expect(memberCacheControl('/UTMMSC/brand/logo.svg')).toBe(STATIC_DAY);
    expect(memberCacheControl('/UTMMSC/icons/icon-192.png')).toBe(STATIC_DAY);
    expect(memberCacheControl('/UTMMSC/channel-icons/megaphone.svg')).toBe(STATIC_DAY);
  });

  it('leaves everything else alone', () => {
    expect(memberCacheControl('/UTMMSC/workbox-old.js')).toBeNull();
    expect(memberCacheControl('/UTMMSC/404.html')).toBeNull();
    expect(memberCacheControl('/UTMMSC/sub/index.html')).toBeNull();
    expect(memberCacheControl('/download/android')).toBeNull();
  });
});

describe('withCacheControl', () => {
  it('sets the header on 200, 206 and 304 and keeps the rest', async () => {
    for (const status of [200, 206]) {
      const response = withCacheControl(new Response('body', { status, headers: { etag: '"x"', 'cache-control': 'public, max-age=0, must-revalidate' } }), IMMUTABLE);
      expect(response.status).toBe(status);
      expect(response.headers.get('cache-control')).toBe(IMMUTABLE);
      expect(response.headers.get('etag')).toBe('"x"');
      expect(await response.text()).toBe('body');
    }
    const notModified = withCacheControl(new Response(null, { status: 304 }), REVALIDATE);
    expect(notModified.status).toBe(304);
    expect(notModified.headers.get('cache-control')).toBe(REVALIDATE);
  });

  it('never marks an error or a missing file as cacheable', () => {
    const missing = new Response('missing', { status: 404, headers: { 'cache-control': 'public, max-age=0, must-revalidate' } });
    expect(withCacheControl(missing, IMMUTABLE)).toBe(missing);
    const kept = new Response('x');
    expect(withCacheControl(kept, null)).toBe(kept);
  });
});
