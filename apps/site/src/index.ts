import { serveAndroidApk } from './download';
import { HOME } from './pages';

const MEMBER_PREFIX = '/UTMMSC';

interface Env {
  ASSETS: Fetcher;
  FILES: R2Bucket;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.hostname === 'www.utmmsc.com') {
      url.hostname = 'utmmsc.com';
      return Response.redirect(url.toString(), 301);
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(HOME, {
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' },
      });
    }
    if (url.pathname === '/download/android' || url.pathname === '/download/android/') return serveAndroidApk(request, env.FILES);
    if (url.pathname === MEMBER_PREFIX) {
      return Response.redirect(`${url.origin}${MEMBER_PREFIX}/${url.search}`, 301);
    }
    if (url.pathname.startsWith(`${MEMBER_PREFIX}/`)) return memberAsset(request, env, url);
    return new Response('未找到', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  },
};

async function memberAsset(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
  }
  const pathname = url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname;
  const asset = await fetchAsset(request, env, pathname);
  if (asset.status !== 404 || pathHasExtension(pathname)) return asset;
  const index = await fetchAsset(request, env, `${MEMBER_PREFIX}/index.html`);
  return new Response(index.body, { status: index.status === 200 ? 200 : index.status, headers: index.headers });
}

function fetchAsset(request: Request, env: Env, pathname: string): Promise<Response> {
  const assetUrl = new URL(request.url);
  assetUrl.pathname = pathname;
  return env.ASSETS.fetch(new Request(assetUrl, request));
}

function pathHasExtension(pathname: string): boolean {
  const last = pathname.split('/').pop() ?? '';
  return last.includes('.');
}
