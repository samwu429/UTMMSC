import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MarkMomentFeedSeenBody, MemberSelf, MomentBadgeResponse, MomentPerson } from '@utmmsc/shared';
import { useSessionStore } from '../../../shared/session/store';
import { BADGE_MIN_GAP_MS, bindMomentsBadgeToSession, createMomentsBadgeStore, type MomentsBadgeApi } from './badgeStore';

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const ZHANG: MomentPerson = { id: 'mem_zhang', displayName: '张三', avatarKey: null };
const LI: MomentPerson = { id: 'mem_li', displayName: '李四', avatarKey: 'avatar/mem_li/a.jpg' };

function badge(extra: Partial<MomentBadgeResponse> = {}): MomentBadgeResponse {
  return { unread: 0, latestActor: null, newPosts: 0, latestAuthor: null, ...extra };
}

/** A fake API whose every call waits until the test answers it. */
/** 每次调用都等测试给出回复的替身接口。 */
function fakeApi() {
  const gets: Deferred<MomentBadgeResponse>[] = [];
  const seen: { body: MarkMomentFeedSeenBody; reply: Deferred<unknown> }[] = [];
  const api: MomentsBadgeApi = {
    badge: () => {
      const reply = deferred<MomentBadgeResponse>();
      gets.push(reply);
      return reply.promise;
    },
    seen: (body) => {
      const reply = deferred<unknown>();
      seen.push({ body, reply });
      return reply.promise;
    },
  };
  return { api, gets, seen };
}

function signIn(id = 'mem_me') {
  useSessionStore.setState({ token: `tok_${id}`, member: { id, displayName: '我', avatarKey: null } as MemberSelf, mediaToken: null });
}

describe('badge store', () => {
  let clock = 0;
  const now = () => clock;

  beforeEach(() => {
    clock = 1_000_000;
    signIn();
  });

  afterEach(() => {
    useSessionStore.setState({ token: null, member: null, mediaToken: null });
  });

  it('loads the counts and shares the answer for a few seconds unless forced', async () => {
    const { api, gets } = fakeApi();
    const store = createMomentsBadgeStore(api, now);
    expect(store.getState().loaded).toBe(false);

    const first = store.getState().refresh();
    gets[0]?.resolve(badge({ unread: 3, latestActor: ZHANG, newPosts: 2, latestAuthor: LI }));
    await first;
    expect(store.getState()).toMatchObject({ loaded: true, unread: 3, latestActor: ZHANG, newPosts: 2, latestAuthor: LI });

    clock += BADGE_MIN_GAP_MS - 1;
    await store.getState().refresh();
    expect(gets).toHaveLength(1);

    const forced = store.getState().refresh({ force: true });
    expect(gets).toHaveLength(2);
    gets[1]?.resolve(badge({ unread: 1, latestActor: ZHANG }));
    await forced;
    expect(store.getState()).toMatchObject({ unread: 1, newPosts: 0, latestAuthor: null });

    clock += BADGE_MIN_GAP_MS;
    void store.getState().refresh();
    expect(gets).toHaveLength(3);
  });

  it('shares a request in flight, and runs once more after it when forced meanwhile', async () => {
    const { api, gets } = fakeApi();
    const store = createMomentsBadgeStore(api, now);
    const a = store.getState().refresh();
    const b = store.getState().refresh();
    expect(b).toBe(a);
    void store.getState().refresh({ force: true });
    expect(gets).toHaveLength(1);
    gets[0]?.resolve(badge({ newPosts: 1 }));
    await flush();
    expect(gets).toHaveLength(2);
    gets[1]?.resolve(badge({ newPosts: 4 }));
    await flush();
    expect(store.getState().newPosts).toBe(4);
  });

  it('keeps the last values when a request fails', async () => {
    const { api, gets } = fakeApi();
    const store = createMomentsBadgeStore(api, now);
    const first = store.getState().refresh();
    gets[0]?.resolve(badge({ unread: 2, latestActor: ZHANG }));
    await first;
    const second = store.getState().refresh({ force: true });
    gets[1]?.reject(new TypeError('offline'));
    await second;
    expect(store.getState()).toMatchObject({ loaded: true, unread: 2, latestActor: ZHANG });
  });

  it('does nothing while signed out', async () => {
    useSessionStore.setState({ token: null, member: null });
    const { api, gets, seen } = fakeApi();
    const store = createMomentsBadgeStore(api, now);
    await store.getState().refresh({ force: true });
    store.getState().markFeedSeen('2026-10-24T10:00:00.000Z');
    expect(gets).toHaveLength(0);
    expect(seen).toHaveLength(0);
  });

  it('clears the new-post dot when the feed was seen, even against a slower poll', async () => {
    const { api, gets, seen } = fakeApi();
    const store = createMomentsBadgeStore(api, now);
    const first = store.getState().refresh();
    gets[0]?.resolve(badge({ newPosts: 3, latestAuthor: LI }));
    await first;

    // A poll leaves before the feed is seen and answers after it.
    // 一次轮询在首页被看之前发出，在之后返回。
    const slow = store.getState().refresh({ force: true });
    store.getState().markFeedSeen('2026-10-24T10:00:00.000Z');
    expect(store.getState()).toMatchObject({ newPosts: 0, latestAuthor: null });
    expect(seen.map((item) => item.body)).toEqual([{ upTo: '2026-10-24T10:00:00.000Z' }]);
    gets[1]?.resolve(badge({ newPosts: 3, latestAuthor: LI }));
    await slow;
    expect(store.getState().newPosts).toBe(0);

    // A poll that leaves while POST /moments/seen is still out cannot know about it either.
    // POST /moments/seen 尚未返回时发出的轮询同样不可能知道它。
    const during = store.getState().refresh({ force: true });
    gets[2]?.resolve(badge({ newPosts: 3, latestAuthor: LI }));
    await during;
    expect(store.getState().newPosts).toBe(0);

    seen[0]?.reply.resolve({ ok: true });
    await flush();
    const after = store.getState().refresh({ force: true });
    gets[3]?.resolve(badge({ newPosts: 1, latestAuthor: ZHANG }));
    await after;
    expect(store.getState()).toMatchObject({ newPosts: 1, latestAuthor: ZHANG });
  });

  it('sends only later seen times, and sends a time again when it was not recorded', async () => {
    const { api, seen } = fakeApi();
    const store = createMomentsBadgeStore(api, now);
    store.getState().markFeedSeen('2026-10-24T10:00:00.000Z');
    store.getState().markFeedSeen('2026-10-24T10:00:00.000Z');
    store.getState().markFeedSeen('2026-10-24T09:00:00.000Z');
    expect(seen).toHaveLength(1);
    seen[0]?.reply.reject(new TypeError('offline'));
    await flush();
    store.getState().markFeedSeen('2026-10-24T10:00:00.000Z');
    expect(seen).toHaveLength(2);
    seen[1]?.reply.resolve({ ok: true });
    await flush();
    store.getState().markFeedSeen('2026-10-24T11:00:00.000Z');
    expect(seen.map((item) => item.body.upTo)).toEqual(['2026-10-24T10:00:00.000Z', '2026-10-24T10:00:00.000Z', '2026-10-24T11:00:00.000Z']);
  });

  it('keeps the unread count from 消息 over a poll that left before it', async () => {
    const { api, gets } = fakeApi();
    const store = createMomentsBadgeStore(api, now);
    const first = store.getState().refresh();
    gets[0]?.resolve(badge({ unread: 5, latestActor: ZHANG }));
    await first;

    const slow = store.getState().refresh({ force: true });
    store.getState().setUnread(0);
    expect(store.getState()).toMatchObject({ unread: 0, latestActor: null });
    gets[1]?.resolve(badge({ unread: 5, latestActor: ZHANG }));
    await slow;
    expect(store.getState()).toMatchObject({ unread: 0, latestActor: null });

    const later = store.getState().refresh({ force: true });
    gets[2]?.resolve(badge({ unread: 1, latestActor: LI }));
    await later;
    expect(store.getState()).toMatchObject({ unread: 1, latestActor: LI });
  });

  it('ignores answers after a reset and starts empty', async () => {
    const { api, gets } = fakeApi();
    const store = createMomentsBadgeStore(api, now);
    const first = store.getState().refresh();
    store.getState().reset();
    gets[0]?.resolve(badge({ unread: 9, latestActor: ZHANG }));
    await first;
    expect(store.getState()).toMatchObject({ loaded: false, unread: 0, latestActor: null, newPosts: 0 });
    // The reset also dropped the min gap and the request in flight.
    // 重置同时清除了最小间隔和进行中的请求。
    void store.getState().refresh();
    expect(gets).toHaveLength(2);
  });

  it('empties on sign-out and when another member signs in', async () => {
    const { api, gets } = fakeApi();
    const store = createMomentsBadgeStore(api, now);
    const stop = bindMomentsBadgeToSession(store);
    const first = store.getState().refresh();
    gets[0]?.resolve(badge({ unread: 2, latestActor: ZHANG }));
    await first;
    signIn('mem_other');
    expect(store.getState()).toMatchObject({ loaded: false, unread: 0 });

    const second = store.getState().refresh();
    gets[1]?.resolve(badge({ newPosts: 1 }));
    await second;
    useSessionStore.setState({ token: null, member: null });
    expect(store.getState()).toMatchObject({ loaded: false, newPosts: 0 });
    stop();
  });
});
