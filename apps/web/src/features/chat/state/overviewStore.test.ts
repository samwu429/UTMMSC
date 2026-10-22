import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelSummary, ChatOverviewResponse, ChatPrefs, ChatPrefsResponse, DirectConversationSummary, MemberSelf, UpdateChatPrefsBody } from '@utmmsc/shared';
import { useSessionStore } from '../../../shared/session/store';
import {
  POLL_INTERVAL_MS,
  REFRESH_MIN_GAP_MS,
  bindOverviewToSession,
  createOverviewStore,
  othersUnread,
  roomById,
  showDot,
  totalUnread,
  type OverviewApi,
} from './overviewStore';

function prefs(extra: Partial<ChatPrefs> = {}): ChatPrefs {
  return { pinned: false, muted: false, markedUnread: false, hiddenAt: null, ...extra };
}

function channel(id: string, unreadCount: number, extra: Partial<ChannelSummary> = {}): ChannelSummary {
  return {
    id,
    slug: id,
    name: id,
    description: null,
    audience: 'all',
    postPolicy: 'members',
    unreadCount,
    lastMessageAt: '2026-10-22T10:00:00.000Z',
    lastMessage: { id: 10, kind: 'text', authorId: 'mem_x', authorName: 'X', text: 'hi', at: '2026-10-22T10:00:00.000Z', system: null },
    joinedAt: null,
    mentionedMe: false,
    prefs: prefs(),
    ...extra,
  };
}

function direct(id: string, unreadCount: number, extra: Partial<DirectConversationSummary> = {}): DirectConversationSummary {
  return {
    id,
    peer: { id: `mem_${id}`, displayName: id, role: 'student', enrollmentStatus: 'student', graduationYear: 2024, avatarKey: null },
    lastMessageAt: '2026-10-22T09:00:00.000Z',
    lastPreview: null,
    unreadCount,
    lastMessage: { id: 3, kind: 'text', authorId: `mem_${id}`, authorName: id, text: 'yo', at: '2026-10-22T09:00:00.000Z', system: null },
    mentionedMe: false,
    prefs: prefs(),
    ...extra,
  };
}

function sample(): ChatOverviewResponse {
  return {
    channels: [
      channel('a', 3),
      channel('muted', 7, { prefs: prefs({ muted: true }) }),
      channel('hidden', 4, { prefs: prefs({ hiddenAt: '2026-10-22T11:00:00.000Z' }) }),
    ],
    direct: [direct('d', 2), direct('marked', 0, { prefs: prefs({ markedUnread: true }) })],
  };
}

describe('selectors', () => {
  it('counts unread of non-muted, visible chats only', () => {
    const data = sample();
    expect(totalUnread(data)).toBe(5);
    expect(totalUnread(null)).toBe(0);
  });

  it('excludes the current room for the back button', () => {
    const data = sample();
    expect(othersUnread(data, 'channel:a')).toBe(2);
    expect(othersUnread(data, 'direct:d')).toBe(3);
    expect(othersUnread(data, 'channel:muted')).toBe(5);
  });

  it('wants a dot for muted unread or a chat marked unread', () => {
    expect(showDot(sample())).toBe(true);
    expect(showDot({ channels: [channel('muted', 2, { prefs: prefs({ muted: true }) })], direct: [] })).toBe(true);
    expect(showDot({ channels: [channel('muted', 0, { prefs: prefs({ muted: true }) })], direct: [] })).toBe(false);
    expect(showDot({ channels: [channel('a', 3)], direct: [] })).toBe(false);
    expect(showDot(null)).toBe(false);
  });

  it('ignores hidden chats for the dot', () => {
    const hiddenMarked = channel('h', 0, { prefs: prefs({ markedUnread: true, hiddenAt: '2026-10-22T11:00:00.000Z' }) });
    expect(showDot({ channels: [hiddenMarked], direct: [] })).toBe(false);
  });

  it('finds rooms by id and returns the same object for the same data', () => {
    const data = sample();
    const room = roomById(data, 'channel:muted');
    expect(room).toMatchObject({ kind: 'channel', title: 'muted', unreadCount: 7, prefs: { muted: true } });
    expect(roomById(data, 'channel:muted')).toBe(room);
    expect(roomById(data, 'direct:d')).toMatchObject({ kind: 'direct', title: 'd' });
    expect(roomById(data, 'channel:none')).toBeNull();
    expect(roomById(null, 'channel:a')).toBeNull();
  });

  it('defaults prefs when an old server sends none', () => {
    const data: ChatOverviewResponse = { channels: [channel('old', 1, { prefs: undefined })], direct: [] };
    expect(roomById(data, 'channel:old')?.prefs).toEqual(prefs());
    expect(totalUnread(data)).toBe(1);
  });
});

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakeApi() {
  const overviews: Deferred<ChatOverviewResponse>[] = [];
  const patches: { roomId: string; body: UpdateChatPrefsBody; reply: Deferred<ChatPrefsResponse> }[] = [];
  const reads: string[] = [];
  const api: OverviewApi = {
    overview: () => {
      const next = deferred<ChatOverviewResponse>();
      overviews.push(next);
      return next.promise;
    },
    updatePrefs: (roomId, body) => {
      const reply = deferred<ChatPrefsResponse>();
      patches.push({ roomId, body, reply });
      return reply.promise;
    },
    markAllRead: async (roomId) => {
      reads.push(roomId);
      return { ok: true };
    },
  };
  return { api, overviews, patches, reads };
}

const member = { id: 'mem_me', role: 'student' } as MemberSelf;

describe('store', () => {
  let clock = 1_000_000;
  const now = () => clock;

  beforeEach(() => {
    clock = 1_000_000;
    useSessionStore.setState({ token: 'tok', member, mediaToken: null });
  });

  afterEach(() => {
    useSessionStore.setState({ token: null, member: null, mediaToken: null });
  });

  it('deduplicates concurrent refreshes and keeps a 10s gap unless forced', async () => {
    const { api, overviews } = fakeApi();
    const store = createOverviewStore(api, now);
    const first = store.getState().refresh();
    const second = store.getState().refresh();
    expect(overviews).toHaveLength(1);
    expect(store.getState().syncing).toBe(true);
    overviews[0]?.resolve(sample());
    await Promise.all([first, second]);
    expect(store.getState().data).not.toBeNull();
    expect(store.getState().syncing).toBe(false);

    clock += REFRESH_MIN_GAP_MS - 1;
    await store.getState().refresh();
    expect(overviews).toHaveLength(1);

    const forced = store.getState().refresh({ force: true });
    expect(overviews).toHaveLength(2);
    overviews[1]?.resolve(sample());
    await forced;
  });

  it('keeps data and flags offline when a refresh fails on the network', async () => {
    const { api, overviews } = fakeApi();
    const store = createOverviewStore(api, now);
    const first = store.getState().refresh();
    overviews[0]?.resolve(sample());
    await first;
    const failed = store.getState().refresh({ force: true, resume: true });
    expect(store.getState().syncing).toBe(true);
    overviews[1]?.reject(new TypeError('Failed to fetch'));
    await failed;
    expect(store.getState()).toMatchObject({ offline: true, syncing: false });
    expect(store.getState().error).toBeTruthy();
    expect(store.getState().data?.channels).toHaveLength(3);
  });

  it('clears a room locally and keeps it cleared against an older reply', async () => {
    const { api, overviews } = fakeApi();
    const store = createOverviewStore(api, now);
    const first = store.getState().refresh();
    overviews[0]?.resolve(sample());
    await first;

    clock += REFRESH_MIN_GAP_MS;
    const slow = store.getState().refresh();
    store.getState().markRoomRead('channel:a');
    expect(roomById(store.getState().data, 'channel:a')?.unreadCount).toBe(0);
    overviews[1]?.resolve(sample());
    await slow;
    expect(roomById(store.getState().data, 'channel:a')?.unreadCount).toBe(0);
    expect(totalUnread(store.getState().data)).toBe(2);
  });

  it('trusts the server once it reports a message newer than the read', async () => {
    const { api, overviews } = fakeApi();
    const store = createOverviewStore(api, now);
    const first = store.getState().refresh();
    overviews[0]?.resolve(sample());
    await first;
    store.getState().markRoomRead('channel:a', 10);

    clock += REFRESH_MIN_GAP_MS;
    const later = store.getState().refresh();
    const newer = sample();
    newer.channels[0] = channel('a', 1, { lastMessage: { id: 11, kind: 'text', authorId: 'mem_x', authorName: 'X', text: 'new', at: '2026-10-22T10:05:00.000Z', system: null } });
    overviews[1]?.resolve(newer);
    await later;
    expect(roomById(store.getState().data, 'channel:a')?.unreadCount).toBe(1);
  });

  it('applies prefs at once, keeps them over a stale poll and adopts the server reply', async () => {
    const { api, overviews, patches } = fakeApi();
    const store = createOverviewStore(api, now);
    const first = store.getState().refresh();
    overviews[0]?.resolve(sample());
    await first;

    const pinning = store.getState().patchPrefs('channel:a', { pinned: true });
    expect(roomById(store.getState().data, 'channel:a')?.prefs.pinned).toBe(true);

    clock += REFRESH_MIN_GAP_MS;
    const poll = store.getState().refresh();
    overviews[1]?.resolve(sample());
    await poll;
    expect(roomById(store.getState().data, 'channel:a')?.prefs.pinned).toBe(true);

    patches[0]?.reply.resolve({ prefs: prefs({ pinned: true }) });
    await pinning;
    expect(patches[0]?.body).toEqual({ pinned: true });
    expect(roomById(store.getState().data, 'channel:a')?.prefs.pinned).toBe(true);
  });

  it('reverts a failed patch', async () => {
    const { api, overviews, patches } = fakeApi();
    const store = createOverviewStore(api, now);
    const first = store.getState().refresh();
    overviews[0]?.resolve(sample());
    await first;

    const muting = store.getState().patchPrefs('direct:d', { muted: true });
    expect(totalUnread(store.getState().data)).toBe(3);
    patches[0]?.reply.reject(new Error('nope'));
    await muting;
    expect(roomById(store.getState().data, 'direct:d')?.prefs.muted).toBe(false);
    expect(totalUnread(store.getState().data)).toBe(5);
  });

  it('hides a room no earlier than its newest message', async () => {
    const { api, overviews, patches } = fakeApi();
    clock = Date.parse('2026-10-22T08:00:00.000Z');
    const store = createOverviewStore(api, now);
    const first = store.getState().refresh();
    overviews[0]?.resolve(sample());
    await first;
    void store.getState().patchPrefs('channel:a', { hidden: true });
    expect(roomById(store.getState().data, 'channel:a')?.prefs.hiddenAt).toBe('2026-10-22T10:00:00.000Z');
    expect(totalUnread(store.getState().data)).toBe(2);
    expect(patches[0]?.body).toEqual({ hidden: true });
  });

  it('marks all read on the server and clears marked unread locally', async () => {
    const { api, overviews, reads } = fakeApi();
    const store = createOverviewStore(api, now);
    const first = store.getState().refresh();
    overviews[0]?.resolve(sample());
    await first;
    await store.getState().markAllRead('direct:marked');
    expect(reads).toEqual(['direct:marked']);
    expect(roomById(store.getState().data, 'direct:marked')?.prefs.markedUnread).toBe(false);
    expect(showDot(store.getState().data)).toBe(true);
  });

  it('resets when the member signs out and drops replies from before', async () => {
    const { api, overviews } = fakeApi();
    const store = createOverviewStore(api, now);
    const unbind = bindOverviewToSession(store);
    const pending = store.getState().refresh();
    useSessionStore.setState({ token: null, member: null });
    overviews[0]?.resolve(sample());
    await pending;
    expect(store.getState().data).toBeNull();
    unbind();
  });

  it('skips fetching without a session', async () => {
    const { api, overviews } = fakeApi();
    useSessionStore.setState({ token: null, member: null });
    const store = createOverviewStore(api, now);
    await store.getState().refresh();
    expect(overviews).toHaveLength(0);
  });

  it('counts pollers so the timer stops only after the last release', async () => {
    vi.useFakeTimers();
    try {
      const { api, overviews } = fakeApi();
      const store = createOverviewStore(api, () => Date.now());
      const stopA = store.getState().startPolling();
      const stopB = store.getState().startPolling();
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
      expect(overviews).toHaveLength(1);
      overviews[0]?.resolve(sample());
      stopA();
      stopA();
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
      expect(overviews).toHaveLength(2);
      overviews[1]?.resolve(sample());
      stopB();
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
      expect(overviews).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
