/**
 * Runtime caching rules of the service worker. vite.config.ts hands these functions to Workbox, which copies their
 * source text into sw.js, so each one may use only its own arguments and worker globals: no imports, no constants
 * from this file, nothing from the page.
 * Service Worker 的运行时缓存规则。vite.config.ts 把这些函数交给 Workbox，Workbox 会把它们的源码原样复制进 sw.js，
 * 所以每个函数只能使用自己的参数和 Worker 全局对象：不能用导入，不能用本文件里的常量，也不能用页面里的任何东西。
 */

/** Cache Storage name of member media (avatars, covers, moment previews, chat images). Cleared on sign-out. */
/** 成员媒体（头像、封面、动态预览、聊天图片）在 Cache Storage 中的名称。退出登录时清空。 */
export const MEDIA_CACHE_NAME = 'utmmsc-media-v1';
export const MEDIA_CACHE_MAX_ENTRIES = 800;
export const MEDIA_CACHE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/** Preset avatar files left out of the precache (the 256 px animated ones), kept after their first use. */
/** 没有放进预缓存的预设头像文件（256 像素动图），第一次使用后保留下来。 */
export const AVATAR_CACHE_NAME = 'utmmsc-avatars-v1';

interface RouteInput {
  url: URL;
  request: Request;
}

/**
 * Images from the API's media routes, on utmmsc.com/api or on the Worker's own address. Videos are left out: they
 * are fetched in ranges, and a whole file in the cache would answer a range request with every byte.
 * 来自 API 媒体路由的图片，无论是 utmmsc.com/api 还是 Worker 自己的地址。视频不在其中：视频按范围读取，缓存里的整份文件会用全部字节回应范围请求。
 */
export const isMediaImageRequest = ({ url, request }: RouteInput): boolean =>
  request.destination === 'image' && /\/(?:members|chat)\/media\//.test(url.pathname);

/**
 * Media keys are random and never reused, so the file behind a key never changes. The token (t) changes every day
 * and retry is only there to get past a failed load, so neither may make the same file a new cache entry.
 * 媒体键是随机生成的，从不复用，所以一个键对应的文件永远不变。令牌（t）每天都变，retry 只是为了绕过一次失败的加载，两者都不能让同一个文件变成新的缓存条目。
 */
export const mediaCacheKey = async ({ request }: { request: Request }): Promise<string> => {
  const url = new URL(request.url);
  url.searchParams.delete('t');
  url.searchParams.delete('retry');
  return url.href;
};

/** WebP preset avatars of this app; requests for precached ones never get this far. */
/** 本应用的 WebP 预设头像；已预缓存的那些请求不会走到这一步。 */
export const isPresetAvatarRequest = ({ url, request, sameOrigin }: RouteInput & { sameOrigin: boolean }): boolean =>
  sameOrigin && request.destination === 'image' && /^\/UTMMSC\/avatars\/[^/]+\.webp$/.test(url.pathname);
