import { forwardToApi, isApiPath, type ApiEnv } from './api';
import { REVALIDATE, memberCacheControl, withCacheControl } from './cache';
import { serveAndroidApk, serveAndroidRelease } from './download';
import { HOME } from './pages';

const MEMBER_PREFIX = '/UTMMSC';

export interface Env extends ApiEnv {
  ASSETS: Fetcher;
  FILES: R2Bucket;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    // Before the www redirect: a redirected POST would turn into a GET, and a socket upgrade cannot follow one.
    // 放在 www 跳转之前：被跳转的 POST 会变成 GET，WebSocket 升级也无法跟随跳转。
    if (isApiPath(url.pathname)) return forwardToApi(request, env);
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
    if (url.pathname === '/download/android.json') return serveAndroidRelease(request, env.FILES);
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

/**
 * A file of the member app, or the app itself for a deep link such as /UTMMSC/chat/room/ch_all. A missing file
 * with an extension (an old hashed chunk after a deploy) stays a 404, so the app can tell it is out of date.
 * 成员网络的文件；对于 /UTMMSC/chat/room/ch_all 这样的深层链接则返回应用本身。带扩展名却不存在的文件（部署后旧的哈希分块）仍返回 404，
 * 应用因此能知道自己已过期。
 */
async function memberAsset(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
  }
  const pathname = url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname;
  const asset = await fetchAsset(request, env, pathname);
  if (asset.status !== 404 || pathHasExtension(pathname)) return withCacheControl(asset, memberCacheControl(pathname));
  const index = await fetchAsset(request, env, `${MEMBER_PREFIX}/index.html`);
  return withCacheControl(new Response(index.body, { status: index.status, headers: index.headers }), REVALIDATE);
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
