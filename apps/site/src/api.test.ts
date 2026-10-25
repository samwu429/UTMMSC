import { describe, expect, it } from 'vitest';
import { DEFAULT_API_ORIGIN, apiTargetUrl, forwardToApi, isApiPath } from './api';

function fakeApi(respond: (request: Request) => Response | Promise<Response> = () => new Response('ok')) {
  const seen: Request[] = [];
  const fetcher = {
    async fetch(input: Request) {
      seen.push(input);
      return respond(input);
    },
  };
  return { seen, API: fetcher as unknown as Fetcher };
}

describe('isApiPath', () => {
  it('matches /api and paths under it only', () => {
    expect(isApiPath('/api')).toBe(true);
    expect(isApiPath('/api/')).toBe(true);
    expect(isApiPath('/api/chat/overview')).toBe(true);
    expect(isApiPath('/apiary')).toBe(false);
    expect(isApiPath('/UTMMSC/api/x')).toBe(false);
    expect(isApiPath('/')).toBe(false);
  });
});

describe('apiTargetUrl', () => {
  it('strips the prefix and keeps the query and the encoding', () => {
    expect(apiTargetUrl(new URL('https://utmmsc.com/api/chat/overview?since=1&x=a%20b'), DEFAULT_API_ORIGIN)).toBe(
      `${DEFAULT_API_ORIGIN}/chat/overview?since=1&x=a%20b`,
    );
    expect(apiTargetUrl(new URL('https://utmmsc.com/api/members/media/avatar%2Fm_1%2Fa.jpg?t=x'), 'https://api.test/')).toBe(
      'https://api.test/members/media/avatar%2Fm_1%2Fa.jpg?t=x',
    );
  });

  it('turns /api and /api/ into the root', () => {
    expect(apiTargetUrl(new URL('https://utmmsc.com/api'), 'https://api.test')).toBe('https://api.test/');
    expect(apiTargetUrl(new URL('https://utmmsc.com/api/'), 'https://api.test')).toBe('https://api.test/');
  });
});

describe('forwardToApi', () => {
  it('sends the method, headers and body to the API Worker at its own address', async () => {
    const api = fakeApi(async (request) => new Response(`${request.method} ${await request.text()}`, { status: 201 }));
    const response = await forwardToApi(
      new Request('https://utmmsc.com/api/chat/rooms/ch_all/ticket?meta=1', {
        method: 'POST',
        headers: { authorization: 'Bearer abc', 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-host': 'evil.test' },
        body: '{"a":1}',
      }),
      { API: api.API },
    );
    expect(response.status).toBe(201);
    expect(await response.text()).toBe('POST {"a":1}');
    const sent = api.seen[0]!;
    expect(sent.url).toBe(`${DEFAULT_API_ORIGIN}/chat/rooms/ch_all/ticket?meta=1`);
    expect(sent.headers.get('authorization')).toBe('Bearer abc');
    expect(sent.headers.get('cf-connecting-ip')).toBe('203.0.113.9');
    expect(sent.headers.get('x-forwarded-host')).toBe('utmmsc.com');
    expect(sent.headers.get('x-forwarded-proto')).toBe('https');
    expect(sent.headers.get('x-forwarded-prefix')).toBe('/api');
    expect(sent.redirect).toBe('manual');
  });

  it('passes a WebSocket upgrade through and uses API_ORIGIN when set', async () => {
    const api = fakeApi();
    await forwardToApi(
      new Request('https://utmmsc.com/api/chat/rooms/ch_all/socket?ticket=t', { headers: { upgrade: 'websocket', connection: 'Upgrade' } }),
      { API: api.API, API_ORIGIN: 'https://api.test' },
    );
    const sent = api.seen[0]!;
    expect(sent.method).toBe('GET');
    expect(sent.url).toBe('https://api.test/chat/rooms/ch_all/socket?ticket=t');
    expect(sent.headers.get('upgrade')).toBe('websocket');
  });

  it('returns the API response unchanged, redirects included', async () => {
    const api = fakeApi(() => new Response(null, { status: 302, headers: { location: 'https://elsewhere.test/', 'cache-control': 'private' } }));
    const response = await forwardToApi(new Request('https://utmmsc.com/api/x'), { API: api.API });
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://elsewhere.test/');
    expect(response.headers.get('cache-control')).toBe('private');
  });

  it('answers 503 in the API error shape without a binding or when the call throws', async () => {
    const missing = await forwardToApi(new Request('https://utmmsc.com/api/x'), {});
    expect(missing.status).toBe(503);
    expect(await missing.json()).toEqual({ error: { code: 'api_unavailable', message: expect.any(String) } });
    const failing = fakeApi(() => {
      throw new Error('down');
    });
    const thrown = await forwardToApi(new Request('https://utmmsc.com/api/x'), { API: failing.API });
    expect(thrown.status).toBe(503);
  });
});
