/**
 * utmmsc.com/api/* is the API Worker, reached through the service binding API. The member app calls it on its own
 * origin, so requests need no CORS preflight and share the page's connection.
 * utmmsc.com/api/* 就是 API Worker，经由服务绑定 API 访问。成员网络在自己的源上调用它，请求不需要 CORS 预检，也与页面共用连接。
 */
export const API_PREFIX = '/api';

/**
 * The URL the API Worker is given. Its origin is the API's own public address, because the API builds absolute
 * URLs from the request URL (the room socket address in a ticket), and that address must keep working when it is
 * reached directly. The x-forwarded-* headers tell the API how the app reached it.
 * 交给 API Worker 的地址。它的源是 API 自己的公开地址：API 会用请求地址拼出绝对地址（票据里的聊天室连接地址），
 * 这个地址在直接访问时也必须可用。x-forwarded-* 请求头告诉 API，App 是从哪里访问它的。
 */
export const DEFAULT_API_ORIGIN = 'https://utmmsc-api.utmmsc.workers.dev';

export interface ApiEnv {
  API?: Fetcher;
  API_ORIGIN?: string;
}

/** /api and everything under /api/, but not /apiary. */
/** /api 及其下的所有路径，但不包括 /apiary 这样的路径。 */
export function isApiPath(pathname: string): boolean {
  return pathname === API_PREFIX || pathname.startsWith(`${API_PREFIX}/`);
}

/** /api/chat/overview?x=1 becomes <origin>/chat/overview?x=1; /api alone becomes <origin>/. */
/** /api/chat/overview?x=1 变成 <origin>/chat/overview?x=1；单独的 /api 变成 <origin>/。 */
export function apiTargetUrl(url: URL, apiOrigin: string): string {
  const rest = url.pathname.slice(API_PREFIX.length) || '/';
  return `${apiOrigin.replace(/\/+$/, '')}${rest}${url.search}`;
}

function unavailable(): Response {
  return new Response(JSON.stringify({ error: { code: 'api_unavailable', message: '服务暂时不可用，请稍后再试' } }), {
    status: 503,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/**
 * Forwards any method, the body and WebSocket upgrades unchanged, and returns the API's response as it is.
 * Redirects are passed to the browser, never followed here.
 * 原样转发任何方法、请求体和 WebSocket 升级，并原样返回 API 的响应。重定向交给浏览器处理，这里不跟随。
 */
export async function forwardToApi(request: Request, env: ApiEnv): Promise<Response> {
  if (!env.API) return unavailable();
  const url = new URL(request.url);
  const headers = new Headers(request.headers);
  headers.set('x-forwarded-host', url.host);
  headers.set('x-forwarded-proto', url.protocol.replace(/:$/, ''));
  headers.set('x-forwarded-prefix', API_PREFIX);
  // The first copy carries the method, body and upgrade over to the new URL; the second only replaces the
  // headers and the redirect mode, so the body is never read here.
  // 第一次复制把方法、请求体和升级请求带到新地址；第二次只替换请求头和重定向方式，因此这里从不读取请求体。
  const moved = new Request(apiTargetUrl(url, env.API_ORIGIN || DEFAULT_API_ORIGIN), request);
  const forwarded = new Request(moved, { headers, redirect: 'manual' });
  try {
    return await env.API.fetch(forwarded);
  } catch {
    return unavailable();
  }
}
