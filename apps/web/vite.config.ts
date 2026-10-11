import { copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const BASE = '/UTMMSC/';

/**
 * GitHub Pages serves 404.html for unknown paths. Copying index.html there lets deep links such
 * as /UTMMSC/chat/c/ch_all load the single-page app instead of a GitHub error page.
 * GitHub Pages 对未知路径返回 404.html。把 index.html 复制为 404.html，使深层链接也能加载单页应用。
 */
function spaFallback(): Plugin {
  return {
    name: 'utmmsc-spa-fallback',
    apply: 'build',
    closeBundle() {
      copyFileSync(resolve(__dirname, 'dist/index.html'), resolve(__dirname, 'dist/404.html'));
    },
  };
}

export default defineConfig({
  base: BASE,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'UTMMSC 成员网络',
        short_name: 'UTMMSC',
        description: 'UTMMSC 成员聊天、名册与文件',
        lang: 'zh-CN',
        start_url: BASE,
        scope: BASE,
        display: 'standalone',
        background_color: '#f7f6f3',
        theme_color: '#f7f6f3',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: `${BASE}index.html`,
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
      },
    }),
    spaFallback(),
  ],
  server: { port: 5173 },
});
