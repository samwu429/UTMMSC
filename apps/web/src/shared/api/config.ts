/** The API Worker's own address. Old cached builds keep calling it, so it stays reachable. */
/** API Worker 自己的地址。旧的缓存版本仍会调用它，所以它一直可以访问。 */
export const WORKER_API_BASE_URL = 'https://utmmsc-api.utmmsc.workers.dev';

/**
 * Hosts whose site Worker forwards /api/* to the API Worker. The Android app loads https://utmmsc.com, so it is
 * one of them.
 * 由网站 Worker 把 /api/* 转发给 API Worker 的域名。安卓 App 加载的是 https://utmmsc.com，所以也在其中。
 */
const SAME_ORIGIN_HOSTS = new Set(['utmmsc.com', 'www.utmmsc.com']);

/**
 * Where the app calls the API, without a trailing slash:
 * - VITE_API_BASE_URL when the build sets it (local development points it at wrangler dev);
 * - `${origin}/api` on utmmsc.com, so calls are same-origin: no CORS preflight and no second DNS/TLS connection;
 * - otherwise the API Worker's workers.dev address.
 * App 调用接口的地址，末尾不带斜杠：
 * - 构建时设置了 VITE_API_BASE_URL 就用它（本地开发把它指向 wrangler dev）；
 * - 在 utmmsc.com 上用 `${origin}/api`，请求同源：不需要 CORS 预检，也不用再建一条 DNS/TLS 连接；
 * - 其他情况用 API Worker 的 workers.dev 地址。
 */
export function resolveApiBase(configured: string | undefined, page: { origin: string; hostname: string } | null | undefined): string {
  const explicit = configured?.trim().replace(/\/+$/, '');
  if (explicit) return explicit;
  if (page && SAME_ORIGIN_HOSTS.has(page.hostname.toLowerCase())) return `${page.origin}/api`;
  return WORKER_API_BASE_URL;
}

function pageLocation(): { origin: string; hostname: string } | null {
  try {
    return typeof location === 'undefined' ? null : { origin: location.origin, hostname: location.hostname };
  } catch {
    return null;
  }
}

/** Read once at startup; the page never changes origin while it runs. */
/** 启动时读取一次；页面运行期间不会换源。 */
export const API_BASE_URL: string = resolveApiBase(import.meta.env.VITE_API_BASE_URL as string | undefined, pageLocation());
