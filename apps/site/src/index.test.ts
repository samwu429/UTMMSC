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
  const env: Env = {
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
  return { env, apiCalls };
}

const get = (url: string, init?: RequestInit) => {
  const { env, apiCalls } = fakeEnv();
  return worker.fetch(new Request(url, init), env).then((response) => ({ response, apiCalls }));
};

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
