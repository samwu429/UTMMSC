import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app/App';
import { chunkReloader } from './app/chunkReload';
import { watchSessionForMediaCache } from './app/mediaCache';
import { startAppUpdates } from './app/pwa';
import { useSessionStore } from './shared/session/store';
import './app/styles.css';

// A chunk that is gone after a deploy reloads the page into the new build (once, and never while offline).
// 部署后已不存在的分块会让页面重新加载到新版本（只重新加载一次，离线时不会）。
window.addEventListener('vite:preloadError', () => chunkReloader().onPreloadError());

// Updates are found and installed in the background, and applied at launch or after the app has been out of sight a
// while, never while a message or a moment is still on its way.
// 在后台查找并安装更新，在启动时或应用不可见一段时间后才切换到新版本；消息或动态还在发送时从不切换。
startAppUpdates();

// Cached member media belongs to whoever is signed in.
// 缓存的成员媒体属于当前登录的成员。
watchSessionForMediaCache(useSessionStore);

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
