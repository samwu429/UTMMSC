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

/** Sticker stills (a few KB each, shown by every grid tile). Cleared on sign-out with the media cache. */
/** 表情的静态图（每张几 KB，每个表情格子都会显示）。退出登录时与媒体缓存一起清空。 */
export const STICKER_THUMB_CACHE_NAME = 'utmmsc-sticker-thumbs-v1';
export const STICKER_THUMB_CACHE_MAX_ENTRIES = 600;
export const STICKER_THUMB_CACHE_MAX_AGE_SECONDS = 60 * 24 * 60 * 60;

/** Sticker files. Ones over 2 MiB are left to the browser's HTTP cache (skipLargeStickerResponses). */
/** 表情文件。超过 2 MiB 的交给浏览器的 HTTP 缓存（见 skipLargeStickerResponses）。 */
export const STICKER_FILE_CACHE_NAME = 'utmmsc-stickers-v1';
export const STICKER_FILE_CACHE_MAX_ENTRIES = 150;
export const STICKER_FILE_CACHE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

interface RouteInput {
  url: URL;
  request: Request;
}

/**
 * A sticker still from members media: sticker/<id>-t-<thumb>, with the slash encoded (as mediaUrl writes it) or not.
 * 来自成员媒体的表情静态图：sticker/<id>-t-<thumb>，斜杠可以是编码后的形式（mediaUrl 的写法），也可以不编码。
 */
export const isStickerThumbRequest = ({ url, request }: RouteInput): boolean =>
  request.destination === 'image' && /\/members\/media\/sticker(?:%2F|\/)stk_[A-Za-z0-9_-]{22}-t-[A-Za-z0-9_-]{22}$/i.test(url.pathname);

/** A sticker file from members media: sticker/<id>.<type>. */
/** 来自成员媒体的表情文件：sticker/<id>.<type>。 */
export const isStickerFileRequest = ({ url, request }: RouteInput): boolean =>
  request.destination === 'image' && /\/members\/media\/sticker(?:%2F|\/)stk_[A-Za-z0-9_-]{22}\.(?:gif|png|webp|jpeg)$/i.test(url.pathname);

/**
 * A cacheWillUpdate plugin for sticker files: responses over 2 MiB are not stored (they stay in the browser's HTTP
 * cache only), so a few large animations cannot push everything else out. A response without a length is kept.
 * 表情文件的 cacheWillUpdate 插件：超过 2 MiB 的响应不存入（只留在浏览器的 HTTP 缓存中），少数几个较大的动图因此不会把其他内容挤出去。
 * 没有长度的响应照常保存。
 */
export const skipLargeStickerResponses = async ({ response }: { response: Response }): Promise<Response | null> => {
  const length = Number(response.headers.get('content-length'));
  return Number.isFinite(length) && length > 2 * 1024 * 1024 ? null : response;
};

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
