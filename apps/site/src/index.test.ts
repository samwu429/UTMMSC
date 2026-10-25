import { describe, expect, it } from 'vitest';
import worker, { type Env } from './index';
import { IMMUTABLE, REVALIDATE } from './cache';

const INDEX_HTML = '<!doctype html><title>app</title>';
const FILES: Record<string, { body: string; type: string }> = {
  '/UTMMSC/index.html': { body: INDEX_HTML, type: 'text/html' },
  '/UTMMSC/assets/index-abc123.js': { body: 'console.log(1)', type: 'text/javascript' },
  '/UTMMSC/sw.js': { body: 'self', type: 'text/javascript' },
  '/UTMMSC/avatars/man-cool-gold-128.webp': { body: 'webp', type: 'image/webp' },
};

function fakeEnv() {
  const apiCalls: Request[] = [];
  const webCalls: Request[] = [];
  const env: Env = {
    WEB: {
      async fetch(input: Request) {
        webCalls.push(input);
        return new Response('<!doctype html><title>site</title>', { headers: { 'content-type': 'text/html' } });
      },
    } as unknown as Fetcher,
    ASSETS: {
      async fetch(input: Request) {
        const file = FILES[new URL(input.url).pathname];
        if (!file) return new Response('not found', { status: 404, headers: { 'cache-control': 'public, max-age=0, must-revalidate' } });
        if (input.headers.get('if-none-match') === '"v1"') return new Response(null, { status: 304, headers: { etag: '"v1"' } });
        return new Response(file.body, { headers: { 'content-type': file.type, etag: '"v1"', 'cache-control': 'public, max-age=0, must-revalidate' } });
      },
    } as unknown as Fetcher,
    FILES: {} as R2Bucket,
    API: {
      async fetch(input: Request) {
        apiCalls.push(input);
        return new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } });
      },
    } as unknown as Fetcher,
  };
  return { env, apiCalls, webCalls };
}

const get = (url: string, init?: RequestInit, options: { withoutWeb?: boolean } = {}) => {
  const { env, apiCalls, webCalls } = fakeEnv();
  if (options.withoutWeb) delete env.WEB;
  return worker.fetch(new Request(url, init), env).then((response) => ({ response, apiCalls, webCalls }));
};

describe('public website forwarding', () => {
  it('hands the home page and every public path to the website Worker unchanged', async () => {
    for (const path of ['/', '/events', '/en/reviews/csc108h5', '/admin/', '/admin/api/session', '/media/img/2026/a.jpg', '/sitemap.xml']) {
      const { response, webCalls } = await get(`https://utmmsc.com${path}?x=1`);
      expect(response.status, path).toBe(200);
      expect(webCalls[0]?.url, path).toBe(`https://utmmsc.com${path}?x=1`);
    }
  });

  it('keeps the member app, its API and downloads away from the website', async () => {
    const member = await get('https://utmmsc.com/UTMMSC/');
    expect(member.webCalls).toHaveLength(0);
    const api = await get('https://utmmsc.com/api/home/daily');
    expect(api.webCalls).toHaveLength(0);
    expect(api.apiCalls).toHaveLength(1);
  });

  it('passes website writes through, such as admin saves', async () => {
    const { webCalls } = await get('https://utmmsc.com/admin/api/events', { method: 'POST', body: '{}' });
    expect(webCalls[0]?.method).toBe('POST');
  });

  it('redirects /index.html to the home page', async () => {
    const { response } = await get('https://utmmsc.com/index.html');
    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toBe('https://utmmsc.com/');
  });

  it('falls back to the holding page and plain 404s without the binding', async () => {
    const home = await get('https://utmmsc.com/', undefined, { withoutWeb: true });
    expect(home.response.status).toBe(200);
    expect(await home.response.text()).toContain('国语学者联盟');
    const other = await get('https://utmmsc.com/events', undefined, { withoutWeb: true });
    expect(other.response.status).toBe(404);
  });
});

describe('site worker routing', () => {
  it('forwards /api/* on both hosts to the API, before the www redirect', async () => {
    const apex = await get('https://utmmsc.com/api/home/daily');
    expect(apex.response.status).toBe(200);
    expect(apex.apiCalls[0]?.url).toBe('https://utmmsc-api.utmmsc.workers.dev/home/daily');
    const www = await get('https://www.utmmsc.com/api/auth/login', { method: 'POST', body: '{}' });
    expect(www.response.status).toBe(200);
    expect(www.apiCalls[0]?.method).toBe('POST');
  });

  it('still redirects www for everything else', async () => {
    const { response } = await get('https://www.utmmsc.com/UTMMSC/chat');
    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toBe('https://utmmsc.com/UTMMSC/chat');
  });

  it('serves hashed assets as immutable and the app shell as no-cache', async () => {
    const asset = await get('https://utmmsc.com/UTMMSC/assets/index-abc123.js');
    expect(asset.response.headers.get('cache-control')).toBe(IMMUTABLE);
    const root = await get('https://utmmsc.com/UTMMSC/');
    expect(await root.response.text()).toBe(INDEX_HTML);
    expect(root.response.headers.get('cache-control')).toBe(REVALIDATE);
    const sw = await get('https://utmmsc.com/UTMMSC/sw.js');
    expect(sw.response.headers.get('cache-control')).toBe(REVALIDATE);
  });

  it('answers a deep link with the app, never cached long', async () => {
    const { response } = await get('https://utmmsc.com/UTMMSC/chat/room/ch_all');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(INDEX_HTML);
    expect(response.headers.get('cache-control')).toBe(REVALIDATE);
    const revalidated = await get('https://utmmsc.com/UTMMSC/timetable/due', { headers: { 'if-none-match': '"v1"' } });
    expect(revalidated.response.status).toBe(304);
    expect(revalidated.response.headers.get('cache-control')).toBe(REVALIDATE);
  });

  it('keeps a missing hashed chunk a plain 404', async () => {
    const { response } = await get('https://utmmsc.com/UTMMSC/assets/RoomPage-old.js');
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate');
  });

  it('refuses writes to member files', async () => {
    const { response } = await get('https://utmmsc.com/UTMMSC/index.html', { method: 'POST', body: 'x' });
    expect(response.status).toBe(405);
  });
});
