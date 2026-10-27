import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { Env } from '../../env';
import type { AppEnv } from '../context';
import { PREFLIGHT_MAX_AGE_SECONDS, corsMiddleware } from './cors';

const app = new Hono<AppEnv>();
app.use('*', corsMiddleware);
app.get('/ping', (c) => c.json({ ok: true }));

const env = { APP_ORIGIN: 'https://utmmsc.com, https://samwu429.github.io' } as unknown as Env;

async function preflight(origin: string): Promise<Response> {
  return app.request(
    '/ping',
    { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' } },
    env,
  );
}

describe('corsMiddleware', () => {
  it('lets a browser keep a preflight answer for two hours', async () => {
    expect(PREFLIGHT_MAX_AGE_SECONDS).toBe(7200);
    const res = await preflight('https://utmmsc.com');
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-max-age')).toBe('7200');
    expect(res.headers.get('access-control-allow-origin')).toBe('https://utmmsc.com');
    expect(res.headers.get('access-control-allow-headers')).toContain('authorization');
  });

  it('allows each listed origin and the local dev servers', async () => {
    for (const origin of ['https://samwu429.github.io', 'http://localhost:5173', 'http://127.0.0.1:5173']) {
      expect((await preflight(origin)).headers.get('access-control-allow-origin')).toBe(origin);
    }
  });

  it('lets the local dev server send a sticker upload with its x-sticker header', async () => {
    const res = await app.request(
      '/ping',
      {
        method: 'OPTIONS',
        headers: {
          origin: 'http://localhost:5173',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'authorization,content-type,x-sticker',
        },
      },
      env,
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    const allowed = (res.headers.get('access-control-allow-headers') ?? '').split(',').map((header) => header.trim());
    expect(allowed).toEqual(expect.arrayContaining(['authorization', 'content-type', 'x-sticker']));
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
  });

  it('allows no other origin', async () => {
    const res = await preflight('https://evil.example');
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    const get = await app.request('/ping', { headers: { origin: 'https://evil.example' } }, env);
    expect(get.headers.get('access-control-allow-origin')).toBeNull();
  });
});
