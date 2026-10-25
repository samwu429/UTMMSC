/** Hashed build output: a file's name changes whenever its content does. */
/** 带哈希的构建产物：内容一变，文件名就变。 */
export const IMMUTABLE = 'public, max-age=31536000, immutable';

/** Files that say which build is current. The browser must ask every time; an unchanged file costs a 304. */
/** 决定当前是哪个版本的文件。浏览器每次都要询问；文件没变时只是一次 304。 */
export const REVALIDATE = 'no-cache';

/**
 * Static files with stable names (avatars, brand, icons, the splash film). A day keeps launches before the service
 * worker takes over off the network, and still lets a file replaced in place reach everyone within a day.
 * 名称固定的静态文件（头像、品牌、图标、开屏影片）。缓存一天，Service Worker 接管之前的启动也不必联网；文件被原地替换时，一天之内也能到达所有人。
 */
export const STATIC_DAY = 'public, max-age=86400';

const MEMBER = '/UTMMSC/';
const BUILD_ENTRY_FILES = new Set(['index.html', 'sw.js', 'push-sw.js', 'manifest.webmanifest', 'registerSW.js']);
const STATIC_DIRS = ['avatars/', 'brand/', 'icons/', 'splash/', 'channel-icons/'];
const WORKBOX_RUNTIME = /^workbox-[0-9a-f]{8}\.js$/;

/**
 * Cache-Control for a file of the member app, by its path under /UTMMSC/. null keeps what the assets service sends.
 * 成员网络中某个文件的 Cache-Control，按它在 /UTMMSC/ 下的路径决定。null 表示沿用静态资源服务给出的值。
 */
export function memberCacheControl(pathname: string): string | null {
  if (!pathname.startsWith(MEMBER)) return null;
  const rest = pathname.slice(MEMBER.length);
  if (rest === '' || BUILD_ENTRY_FILES.has(rest)) return REVALIDATE;
  if (rest.startsWith('assets/') || WORKBOX_RUNTIME.test(rest)) return IMMUTABLE;
  if (STATIC_DIRS.some((dir) => rest.startsWith(dir))) return STATIC_DAY;
  return null;
}

/**
 * Sets the header on a successful or not-modified response. Errors keep the defaults, so a missing file is never
 * cached for a year.
 * 只给成功或未修改的响应设置该请求头。出错的响应保持默认值，缺失的文件因此永远不会被缓存一年。
 */
export function withCacheControl(response: Response, value: string | null): Response {
  if (!value || !(response.status === 200 || response.status === 206 || response.status === 304)) return response;
  const headers = new Headers(response.headers);
  headers.set('cache-control', value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
