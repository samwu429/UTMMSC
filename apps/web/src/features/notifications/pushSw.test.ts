import { describe, expect, it } from 'vitest';
import source from '../../../public/push-sw.js?raw';

const SCOPE = 'https://utmmsc.com/UTMMSC/';

interface FakeWindow {
  /** Where the app says it is now, answered to the worker's question. */
  /** 应用回答 Service Worker 时所说的当前位置。 */
  at: string;
  focused?: boolean;
}

/**
 * Loads push-sw.js against a fake worker scope with these windows open, delivers one push, and returns the
 * titles of the notices it showed.
 * 在一个模拟的 Service Worker 环境中加载 push-sw.js，打开这些窗口，送达一条推送，并返回它显示的通知标题。
 */
async function deliver(payload: Record<string, unknown>, windows: FakeWindow[]): Promise<string[]> {
  const shown: string[] = [];
  const listeners = new Map<string, (event: unknown) => void>();
  const clients = windows.map((window) => ({
    url: SCOPE,
    focused: window.focused ?? true,
    visibilityState: 'visible',
    postMessage(message: { type?: string }, ports?: MessagePort[]) {
      if (message.type === 'utmmsc:where') ports?.[0]?.postMessage(SCOPE + window.at.replace(/^\//, ''));
    },
  }));
  const scope = {
    location: new URL(SCOPE),
    registration: {
      scope: SCOPE,
      showNotification: (title: string) => {
        shown.push(title);
        return Promise.resolve();
      },
      getNotifications: () => Promise.resolve([]),
      pushManager: { getSubscription: () => Promise.resolve(null) },
    },
    clients: { matchAll: () => Promise.resolve(clients) },
    addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
  };
  // The worker script reads `self` as a free variable; everything else is the test's own globals.
  // Service Worker 脚本把 `self` 当作自由变量读取；其他全局对象都使用测试本身的。
  new Function('self', source)(scope);
  const waits: Promise<unknown>[] = [];
  listeners.get('push')?.({ data: { json: () => payload }, waitUntil: (promise: Promise<unknown>) => waits.push(promise) });
  await Promise.all(waits);
  return shown;
}

const COMMENT = { title: '张三评论了你', body: '好看', tag: 'moment:p1', url: `${SCOPE}discover/feed/post/p1?comment=c1`, kind: 'moment', postId: 'p1' };

describe('push-sw moments pushes', () => {
  it('stays quiet on the home feed, which shows the new activity itself', async () => {
    expect(await deliver(COMMENT, [{ at: '/discover/feed' }])).toEqual([]);
    expect(await deliver(COMMENT, [{ at: '/discover/feed/' }])).toEqual([]);
    expect(await deliver(COMMENT, [{ at: '/discover/feed?x=1' }])).toEqual([]);
  });

  it('still shows the notice on the other moments pages, which show nothing new', async () => {
    for (const at of ['/discover/feed/post/p1?comment=c0', '/discover/feed/notices', '/discover/feed/member/m1', '/discover/feed/settings']) {
      expect(await deliver(COMMENT, [{ at }])).toEqual([COMMENT.title]);
    }
  });

  it('shows the notice when the home feed is open but not in front', async () => {
    expect(await deliver(COMMENT, [{ at: '/discover/feed', focused: false }])).toEqual([COMMENT.title]);
    expect(await deliver(COMMENT, [{ at: '/chat' }])).toEqual([COMMENT.title]);
  });
});
