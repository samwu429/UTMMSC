import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import {
  AVATAR_CACHE_NAME,
  MEDIA_CACHE_MAX_AGE_SECONDS,
  MEDIA_CACHE_MAX_ENTRIES,
  MEDIA_CACHE_NAME,
  isMediaImageRequest,
  isPresetAvatarRequest,
  mediaCacheKey,
} from './src/app/swRoutes';

const BASE = '/UTMMSC/';

export default defineConfig({
  base: BASE,
  plugins: [
    react(),
    VitePWA({
      // pwa.ts registers the worker itself and decides when a new one takes over (at launch, or once the app has been
      // hidden a while); the plugin's own registerSW.js would register it twice and take over at once.
      // pwa.ts 自行注册 Service Worker，并决定新版本何时接管（启动时，或应用不可见一段时间之后）；插件自带的 registerSW.js 会重复注册并立即接管。
      registerType: 'prompt',
      injectRegister: false,
      // The icons are already matched by globPatterns; listing them again only duplicated precache entries.
      // 图标已被 globPatterns 匹配；再列一次只会让预缓存条目重复。
      includeManifestIcons: false,
      manifest: {
        name: 'UTMMSC 成员网络',
        short_name: 'UTMMSC',
        description: 'UTMMSC 成员聊天、名册与文件',
        lang: 'zh-CN',
        start_url: BASE,
        scope: BASE,
        display: 'standalone',
        background_color: '#F7F4EE',
        theme_color: '#3C165F',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: `${BASE}index.html`,
        globPatterns: ['**/*.{js,css,html,png,svg,webp,woff2,mp4}'],
        globIgnores: [
          // Deep links are answered by the site Worker, so there is no 404.html any more.
          // 深层链接由网站 Worker 应答，所以不再有 404.html。
          '**/404.html',
          // Only emails use the PNG logo; the avatar mark is unused by the app.
          // 只有邮件用到 PNG 标志；头像标志应用里没有用到。
          'brand/logo-horizontal.png',
          'brand/avatar.svg',
          // The old preset avatars stay deployed for old cached builds, but this build draws WebP files. Of those,
          // the 256 px animated ones (profile, 我的, chooser) are cached on first use instead.
          // 旧的预设头像仍然部署，供旧的缓存版本使用，但本版本使用 WebP 文件。其中 256 像素的动图（资料页、我的、头像选择）改为第一次使用时缓存。
          'avatars/*.gif',
          'avatars/*.png',
          'avatars/*-256.webp',
          // Push notifications fetch these over the network; the app draws the SVG presets.
          // 推送通知通过网络获取这些文件；应用里画的是 SVG 预设图标。
          'channel-icons/*.png',
        ],
        // A waiting worker takes over only when pwa.ts tells it to, never on its own.
        // 等待中的 Service Worker 只有在 pwa.ts 通知时才接管，从不自行接管。
        skipWaiting: false,
        clientsClaim: false,
        runtimeCaching: [
          {
            // Member media never changes behind a key, so a cached copy is used without asking, across launches and
            // across the daily token change. Only full 200 responses are kept: not videos, not opaque replies.
            // 成员媒体在同一个键下永不改变，所以缓存的副本无需询问即可使用，跨越多次启动，也跨越每天一次的令牌变化。只保存完整的 200 响应：
            // 不存视频，也不存不透明响应。
            urlPattern: isMediaImageRequest,
            handler: 'CacheFirst',
            options: {
              cacheName: MEDIA_CACHE_NAME,
              expiration: { maxEntries: MEDIA_CACHE_MAX_ENTRIES, maxAgeSeconds: MEDIA_CACHE_MAX_AGE_SECONDS, purgeOnQuotaError: true },
              cacheableResponse: { statuses: [200] },
              plugins: [{ cacheKeyWillBeUsed: mediaCacheKey }],
            },
          },
          {
            urlPattern: isPresetAvatarRequest,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: AVATAR_CACHE_NAME,
              expiration: { maxEntries: 16, purgeOnQuotaError: true },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
        // Push and notification-click handlers live in public/push-sw.js, beside the generated worker.
        // 推送与点击通知的处理写在 public/push-sw.js 中，与生成的 Service Worker 放在一起。
        importScripts: ['push-sw.js'],
      },
    }),
  ],
  server: { port: 5173 },
});
