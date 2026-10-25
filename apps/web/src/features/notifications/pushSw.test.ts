import { describe, expect, it } from 'vitest';
import source from '../../../public/push-sw.js?raw';

const SCOPE = 'https://utmmsc.com/UTMMSC/';
const APP_ICON = `${SCOPE}icons/icon-192.png`;
const APP_BADGE = `${SCOPE}icons/badge-96.png`;

interface FakeWindow {
  /** Where the app says it is now, answered to the worker's question. */
  /** 应用回答 Service Worker 时所说的当前位置。 */
  at: string;
  focused?: boolean;
}

/** A notice the worker showed: its title and the options it passed to showNotification. */
/** Service Worker 显示的一条通知：标题以及传给 showNotification 的选项。 */
interface ShownNotice {
  title: string;
  options: { body?: string; icon?: string; badge?: string; tag?: string; renotify?: boolean; silent?: boolean; data?: { url?: string; kind?: string } };
}

/**
 * Loads push-sw.js against a fake worker scope with these windows open, delivers one push (null for a push with no
 * data), and returns the notices it showed.
 * 在一个模拟的 Service Worker 环境中加载 push-sw.js，打开这些窗口，送达一条推送（null 表示没有数据的推送），并返回它显示的通知。
 */
async function deliverNotices(payload: Record<string, unknown> | null, windows: FakeWindow[] = []): Promise<ShownNotice[]> {
  const shown: ShownNotice[] = [];
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
      showNotification: (title: string, options: ShownNotice['options']) => {
        shown.push({ title, options });
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
  const data = payload === null ? null : { json: () => payload };
  listeners.get('push')?.({ data, waitUntil: (promise: Promise<unknown>) => waits.push(promise) });
  await Promise.all(waits);
  return shown;
}

/** The titles of the notices one push showed. */
/** 一条推送显示的通知标题。 */
async function deliver(payload: Record<string, unknown>, windows: FakeWindow[]): Promise<string[]> {
  return (await deliverNotices(payload, windows)).map((notice) => notice.title);
}

/** The single notice one push showed, with no window open. */
/** 没有打开窗口时，一条推送显示的唯一一条通知。 */
async function only(payload: Record<string, unknown> | null): Promise<ShownNotice> {
  const notices = await deliverNotices(payload);
  expect(notices).toHaveLength(1);
  return notices[0] as ShownNotice;
}

const COMMENT = { title: '张三评论了你', body: '好看', tag: 'moment:p1', url: `${SCOPE}discover/feed/post/p1?comment=c1`, kind: 'moment', postId: 'p1' };
const CLASS = { title: 'MAT102 · 10 分钟后上课', body: '10:00–10:50 · DV 2074 · 讲座', tag: 'tt:class', url: `${SCOPE}timetable?date=2026-10-26&focus=tm_AAAAAAAAAAAAAAAAAAAAAA`, kind: 'class' };
const DUE = { title: '作业截止提醒 · PS3', body: 'MAT102 · 明天 23:59 截止（还有 1 天）', tag: 'tt:due:ta_AAAAAAAAAAAAAAAAAAAAAA', url: `${SCOPE}timetable/due?focus=ta_AAAAAAAAAAAAAAAAAAAAAA`, kind: 'assignment' };
const MESSAGE = { title: '学术交流', body: '张三: 你好', tag: 'channel:ch_study', url: `${SCOPE}chat/room/channel%3Ach_study`, kind: 'message', roomId: 'channel:ch_study' };

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

describe('push-sw timetable reminders', () => {
  it('alerts again for the next class and a nearer deadline under the same tag', async () => {
    expect(await only(CLASS)).toMatchObject({ title: CLASS.title, options: { tag: 'tt:class', renotify: true, silent: false } });
    expect(await only(DUE)).toMatchObject({ title: DUE.title, options: { tag: DUE.tag, renotify: true, silent: false } });
  });

  it('shows a reminder on every page, the timetable itself included', async () => {
    for (const at of ['/timetable', '/timetable/due', '/', '/chat']) {
      expect(await deliver(CLASS, [{ at }])).toEqual([CLASS.title]);
      expect(await deliver(DUE, [{ at }])).toEqual([DUE.title]);
    }
  });

  it('opens the week or the assignment the reminder names', async () => {
    expect((await only(CLASS)).options.data).toMatchObject({ url: CLASS.url, kind: 'class' });
    expect((await only(DUE)).options.data).toMatchObject({ url: DUE.url, kind: 'assignment' });
  });
});

describe('push-sw alerting', () => {
  it('alerts again only for kinds where a newer notice is news', async () => {
    const renotify = async (kind: string) => (await only({ ...MESSAGE, kind })).options.renotify;
    expect(await renotify('message')).toBe(true);
    expect(await renotify('moment')).toBe(true);
    expect(await renotify('class')).toBe(true);
    expect(await renotify('assignment')).toBe(true);
    expect(await renotify('recall')).toBe(false);
    expect(await renotify('moment_recall')).toBe(false);
    expect(await renotify('event')).toBe(false);
    expect(await renotify('test')).toBe(false);
  });

  it('replaces a withdrawn message or a deleted comment without sound', async () => {
    expect((await only({ ...MESSAGE, kind: 'recall' })).options.silent).toBe(true);
    expect((await only({ ...COMMENT, kind: 'moment_recall' })).options.silent).toBe(true);
    expect((await only(MESSAGE)).options.silent).toBe(false);
  });
});

describe('push-sw icons', () => {
  const UPLOADED = 'https://utmmsc.com/api/members/media/channel-icon%2Fch_study%2Fcic_AbCdEfGhIjKlMnOp.webp?t=tok';
  const PRESET = `${SCOPE}channel-icons/academic-192.png`;

  it("shows the channel's icon the server chose, uploaded or preset, and keeps the app badge", async () => {
    expect((await only({ ...MESSAGE, icon: UPLOADED })).options).toMatchObject({ icon: UPLOADED, badge: APP_BADGE });
    expect((await only({ ...MESSAGE, icon: PRESET })).options).toMatchObject({ icon: PRESET, badge: APP_BADGE });
  });

  it('shows the app icon when the push names none', async () => {
    expect((await only(MESSAGE)).options).toMatchObject({ icon: APP_ICON, badge: APP_BADGE });
    expect((await only(CLASS)).options.icon).toBe(APP_ICON);
    expect(await only(null)).toMatchObject({ title: 'UTMMSC', options: { icon: APP_ICON, badge: APP_BADGE } });
  });

  it('accepts only an https address, and shows the app icon for anything else', async () => {
    const refused: unknown[] = [
      '',
      'http://utmmsc.com/UTMMSC/channel-icons/academic-192.png',
      'HTTPS://utmmsc.com/UTMMSC/channel-icons/academic-192.png',
      '/UTMMSC/channel-icons/academic-192.png',
      'channel-icons/academic-192.png',
      '//utmmsc.com/UTMMSC/channel-icons/academic-192.png',
      'javascript:alert(1)',
      'data:image/png;base64,iVBORw0KGgo=',
      'https://',
      'https:// utmmsc.com/x.png',
      `https://utmmsc.com/${'a'.repeat(2100)}.png`,
      42,
      { href: UPLOADED },
      [UPLOADED],
      null,
    ];
    for (const icon of refused) {
      expect((await only({ ...MESSAGE, icon })).options.icon).toBe(APP_ICON);
    }
  });
});
