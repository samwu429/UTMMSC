import {
  channelRoomId,
  directRoomId,
  type ChannelSummary,
  type ChatOverviewResponse,
  type ChatPrefs,
  type ChatPrefsResponse,
  type DirectConversationSummary,
  type UpdateChatPrefsBody,
} from '@utmmsc/shared';
import { create } from 'zustand';
import { errorMessage } from '../../../shared/api/errors';
import { useSessionStore } from '../../../shared/session/store';
import { toast } from '../../../shared/ui/toast';
import { chatApi } from '../api';
import { DEFAULT_CHAT_PREFS, isHiddenRoom, prefsOf } from '../list/conversations';

/** Calls the store needs; tests pass a fake. */
/** store 需要的接口调用；测试时传入替身。 */
export interface OverviewApi {
  overview: () => Promise<ChatOverviewResponse>;
  updatePrefs: (roomId: string, body: UpdateChatPrefsBody) => Promise<ChatPrefsResponse>;
  markAllRead: (roomId: string) => Promise<unknown>;
}

export interface RefreshOptions {
  /** Skip the 10s minimum gap, for example after coming back online. */
  /** 跳过 10 秒最小间隔，例如网络恢复之后。 */
  force?: boolean;
  /** The app came back to the foreground, so the title shows 收取中… while it loads. */
  /** 应用回到前台，加载期间标题显示「收取中…」。 */
  resume?: boolean;
}

export interface OverviewState {
  data: ChatOverviewResponse | null;
  /** Localized message of the last failed fetch, cleared by the next success. */
  /** 上次加载失败的提示（已翻译），下次成功后清除。 */
  error: string | null;
  offline: boolean;
  syncing: boolean;
  loadedAt: number | null;
  refresh: (options?: RefreshOptions) => Promise<void>;
  /** Polls every 30s while at least one caller holds it, skipping ticks while the page is hidden. Returns the release function. */
  /** 只要还有调用方持有，就每 30 秒轮询一次，页面隐藏时跳过。返回释放函数。 */
  startPolling: () => () => void;
  /** Clears the room's badge locally. Pass the newest id the member has read when it is known. */
  /** 在本地清除该房间的角标。已知成员读到的最新 id 时一并传入。 */
  markRoomRead: (roomId: string, readUpToId?: number | null) => void;
  patchPrefs: (roomId: string, patch: UpdateChatPrefsBody) => Promise<void>;
  /** 标为已读: marks everything read on the server and clears 标为未读. */
  /** 标为已读：在服务端把全部标为已读，并清除「标为未读」。 */
  markAllRead: (roomId: string) => Promise<void>;
  setOffline: (offline: boolean) => void;
  reset: () => void;
}

export const REFRESH_MIN_GAP_MS = 10_000;
export const POLL_INTERVAL_MS = 30_000;
/** A read cleared locally is trusted for this long, unless the server reports a newer message. */
/** 本地清除的已读状态在这段时间内优先采用，除非服务端报告了更新的消息。 */
export const READ_GRACE_MS = 5_000;

export type OverviewRoom =
  | { roomId: string; kind: 'channel'; title: string; summary: ChannelSummary; prefs: ChatPrefs; unreadCount: number }
  | { roomId: string; kind: 'direct'; title: string; summary: DirectConversationSummary; prefs: ChatPrefs; unreadCount: number };

const roomIndexes = new WeakMap<ChatOverviewResponse, Map<string, OverviewRoom>>();

function indexOf(data: ChatOverviewResponse): Map<string, OverviewRoom> {
  const cached = roomIndexes.get(data);
  if (cached) return cached;
  const index = new Map<string, OverviewRoom>();
  for (const channel of data.channels) {
    const roomId = channelRoomId(channel.id);
    index.set(roomId, { roomId, kind: 'channel', title: channel.name, summary: channel, prefs: prefsOf(channel), unreadCount: channel.unreadCount });
  }
  for (const dm of data.direct) {
    const roomId = directRoomId(dm.id);
    index.set(roomId, { roomId, kind: 'direct', title: dm.peer.displayName, summary: dm, prefs: prefsOf(dm), unreadCount: dm.unreadCount });
  }
  roomIndexes.set(data, index);
  return index;
}

/** The room's summary and prefs. The object stays the same until the data changes, so it is safe as a selector. */
/** 该房间的概要与设置。数据不变时返回同一个对象，可直接用作选择器。 */
export function roomById(data: ChatOverviewResponse | null, roomId: string): OverviewRoom | null {
  if (!data) return null;
  return indexOf(data).get(roomId) ?? null;
}

function visibleRooms(data: ChatOverviewResponse | null): OverviewRoom[] {
  if (!data) return [];
  const rooms: OverviewRoom[] = [];
  for (const room of indexOf(data).values()) {
    if (!isHiddenRoom(room.prefs, room.summary.lastMessage)) rooms.push(room);
  }
  return rooms;
}

/** Unread count for the tab badge. Muted chats and chats hidden from the list do not count. */
/** 标签角标的未读数。免打扰和不显示的会话不计入。 */
export function totalUnread(data: ChatOverviewResponse | null, exceptRoomId?: string): number {
  let total = 0;
  for (const room of visibleRooms(data)) {
    if (room.roomId === exceptRoomId || room.prefs.muted) continue;
    total += Math.max(0, room.unreadCount);
  }
  return total;
}

/** Unread count of every other chat, shown next to a room's back button. */
/** 其他会话的未读数，显示在房间返回键旁边。 */
export function othersUnread(data: ChatOverviewResponse | null, roomId: string): number {
  return totalUnread(data, roomId);
}

/** True when some chat wants a plain dot: a muted chat with unread, or one marked unread. */
/** 有会话需要显示小红点时为 true：有未读的免打扰会话，或被标为未读的会话。 */
export function showDot(data: ChatOverviewResponse | null): boolean {
  return visibleRooms(data).some((room) => (room.prefs.muted && room.unreadCount > 0) || room.prefs.markedUnread);
}

function mapRoom(
  data: ChatOverviewResponse,
  roomId: string,
  channelFn: (channel: ChannelSummary) => ChannelSummary,
  directFn: (dm: DirectConversationSummary) => DirectConversationSummary,
): ChatOverviewResponse {
  const room = roomById(data, roomId);
  if (!room) return data;
  if (room.kind === 'channel') {
    return { ...data, channels: data.channels.map((channel) => (channel === room.summary ? channelFn(channel) : channel)) };
  }
  return { ...data, direct: data.direct.map((dm) => (dm === room.summary ? directFn(dm) : dm)) };
}

function withPrefs<T extends ChannelSummary | DirectConversationSummary>(summary: T, fields: Partial<ChatPrefs>): T {
  const prefs = prefsOf(summary);
  const changed = (Object.keys(fields) as (keyof ChatPrefs)[]).some((key) => prefs[key] !== fields[key]);
  return changed ? { ...summary, prefs: { ...prefs, ...fields } } : summary;
}

function withRead<T extends ChannelSummary | DirectConversationSummary>(summary: T): T {
  const prefs = prefsOf(summary);
  const mentioned = 'mentionedMe' in summary && summary.mentionedMe === true;
  if (summary.unreadCount === 0 && !mentioned && !prefs.markedUnread) return summary;
  const next = { ...summary, unreadCount: 0, mentionedMe: false };
  return prefs.markedUnread ? { ...next, prefs: { ...prefs, markedUnread: false } } : next;
}

export function applyPrefsFields(data: ChatOverviewResponse, roomId: string, fields: Partial<ChatPrefs>): ChatOverviewResponse {
  return mapRoom(data, roomId, (channel) => withPrefs(channel, fields), (dm) => withPrefs(dm, fields));
}

export function applyRead(data: ChatOverviewResponse, roomId: string): ChatOverviewResponse {
  return mapRoom(data, roomId, withRead, withRead);
}

/** Optimistic prefs for a patch. A hide is stamped no earlier than the newest message, so the row leaves even with a slow clock. */
/** 根据补丁得到的乐观设置。隐藏的时间不早于最新消息，因此本机时钟偏慢时该行也会消失。 */
export function patchedPrefs(patch: UpdateChatPrefsBody, lastAt: string | null, nowIso: string): Partial<ChatPrefs> {
  const fields: Partial<ChatPrefs> = {};
  if (patch.pinned !== undefined) fields.pinned = patch.pinned;
  if (patch.muted !== undefined) fields.muted = patch.muted;
  if (patch.markedUnread !== undefined) fields.markedUnread = patch.markedUnread;
  if (patch.hidden !== undefined) fields.hiddenAt = patch.hidden ? (lastAt && lastAt > nowIso ? lastAt : nowIso) : null;
  return fields;
}

interface ReadMark {
  seq: number;
  at: number;
  upToId: number | null;
}

interface PrefsMark {
  seq: number;
  pending: number;
  fields: Partial<ChatPrefs>;
}

function lastIdOf(room: OverviewRoom | null): number | null {
  return room?.summary.lastMessage?.id ?? null;
}

function lastAtOf(room: OverviewRoom | null): string | null {
  return room?.summary.lastMessage?.at ?? room?.summary.lastMessageAt ?? null;
}

function isNetworkFailure(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/**
 * Conversation list data shared by the chat tab, the tab badge and the room header. Local changes
 * (a read, a pin, a hide) show at once and are kept on top of any fetch that started before the
 * server saw them, so a slow poll never brings an old badge back.
 * 聊天页、标签角标和房间标题栏共用的会话列表数据。本地改动（已读、置顶、隐藏）立即生效，
 * 并会覆盖在服务端看到它们之前发出的请求结果，慢一步的轮询不会把旧角标带回来。
 */
export function createOverviewStore(api: OverviewApi, now: () => number = Date.now) {
  let generation = 0;
  let seq = 0;
  let inflight: Promise<void> | null = null;
  let again: RefreshOptions | null = null;
  let lastStartedAt: number | null = null;
  let pollers = 0;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  const readMarks = new Map<string, ReadMark>();
  const prefsMarks = new Map<string, PrefsMark>();
  const patchSeq = new Map<string, number>();

  // Reads go first and prefs second, so a later 标为未读 wins over an earlier read.
  // 先套用已读、再套用设置，这样之后的「标为未读」会覆盖之前的已读。
  function overlay(data: ChatOverviewResponse, startSeq: number): ChatOverviewResponse {
    let next = data;
    const at = now();
    for (const [roomId, mark] of readMarks) {
      const predates = mark.seq > startSeq;
      const fresh = at - mark.at < READ_GRACE_MS;
      if (!predates && !fresh) {
        readMarks.delete(roomId);
        continue;
      }
      const serverLastId = lastIdOf(roomById(next, roomId));
      const newer = serverLastId !== null && mark.upToId !== null && serverLastId > mark.upToId;
      if (predates || !newer) next = applyRead(next, roomId);
    }
    for (const [roomId, mark] of prefsMarks) {
      const keep = mark.pending > 0 || mark.seq > startSeq;
      if (keep) next = applyPrefsFields(next, roomId, mark.fields);
      else prefsMarks.delete(roomId);
    }
    return next;
  }

  const store = create<OverviewState>()((set, get) => {
    function load(options: RefreshOptions): Promise<void> {
      const startGeneration = generation;
      const startSeq = seq;
      lastStartedAt = now();
      if (options.resume || !get().data) set({ syncing: true });
      const run = api
        .overview()
        .then((res) => {
          if (startGeneration !== generation) return;
          set({ data: overlay(res, startSeq), error: null, offline: false, loadedAt: now() });
        })
        .catch((error: unknown) => {
          if (startGeneration !== generation) return;
          set({ error: errorMessage(error), offline: isNetworkFailure(error) });
        })
        .finally(() => {
          if (startGeneration !== generation) return;
          inflight = null;
          const queued = again;
          again = null;
          if (queued) {
            inflight = load(queued);
            return;
          }
          set({ syncing: false });
        });
      return run;
    }

    function refresh(options: RefreshOptions = {}): Promise<void> {
      if (!useSessionStore.getState().token) return Promise.resolve();
      if (inflight) {
        if (options.resume) set({ syncing: true });
        // A forced refresh follows something the request in flight may predate, such as a local change or a role
        // switch, so it runs again once that request settles instead of sharing its reply.
        // 强制刷新针对的变化（例如本地改动或切换身份）可能晚于正在进行的请求，所以等该请求结束后再加载一次，而不是共用它的结果。
        if (options.force) again = { force: true, resume: options.resume || again?.resume };
        return inflight;
      }
      const started = lastStartedAt;
      if (!options.force && started !== null && get().data && now() - started < REFRESH_MIN_GAP_MS) return Promise.resolve();
      inflight = load(options);
      return inflight;
    }

    function stopTimer() {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
    }

    return {
      data: null,
      error: null,
      offline: false,
      syncing: false,
      loadedAt: null,
      refresh,
      startPolling: () => {
        pollers += 1;
        if (pollers === 1 && !pollTimer) {
          pollTimer = setInterval(() => {
            if (typeof document !== 'undefined' && document.hidden) return;
            void refresh();
          }, POLL_INTERVAL_MS);
        }
        let released = false;
        return () => {
          if (released) return;
          released = true;
          pollers = Math.max(0, pollers - 1);
          if (pollers === 0) stopTimer();
        };
      },
      markRoomRead: (roomId, readUpToId = null) => {
        const data = get().data;
        const room = roomById(data, roomId);
        const known = lastIdOf(room);
        const upToId = readUpToId === null ? known : known === null ? readUpToId : Math.max(known, readUpToId);
        seq += 1;
        readMarks.set(roomId, { seq, at: now(), upToId });
        const pending = prefsMarks.get(roomId);
        if (pending && pending.fields.markedUnread === true) pending.fields = { ...pending.fields, markedUnread: false };
        if (data) {
          const next = applyRead(data, roomId);
          if (next !== data) set({ data: next });
        }
      },
      patchPrefs: async (roomId, patch) => {
        const data = get().data;
        const room = roomById(data, roomId);
        const before = room?.prefs ?? DEFAULT_CHAT_PREFS;
        const fields = patchedPrefs(patch, lastAtOf(room), new Date(now()).toISOString());
        if (Object.keys(fields).length === 0) return;
        const startGeneration = generation;
        seq += 1;
        const mine = seq;
        patchSeq.set(roomId, mine);
        const mark = prefsMarks.get(roomId) ?? { seq: mine, pending: 0, fields: {} };
        mark.seq = mine;
        mark.pending += 1;
        mark.fields = { ...mark.fields, ...fields };
        prefsMarks.set(roomId, mark);
        if (data) set({ data: applyPrefsFields(data, roomId, fields) });
        try {
          const res = await api.updatePrefs(roomId, patch);
          if (startGeneration !== generation) return;
          mark.pending = Math.max(0, mark.pending - 1);
          if (patchSeq.get(roomId) !== mine) return;
          // The latest patch for this room is settled; the server's prefs win from here on.
          // 这个房间最新的补丁已经完成；此后以服务端的设置为准。
          seq += 1;
          mark.seq = seq;
          mark.fields = { ...res.prefs };
          const current = get().data;
          if (current) set({ data: applyPrefsFields(current, roomId, res.prefs) });
        } catch (error) {
          if (startGeneration !== generation) return;
          mark.pending = Math.max(0, mark.pending - 1);
          // Only the latest patch rolls back; a newer one in flight decides the final state itself.
          // 只有最新的补丁才回滚；仍在进行中的更新补丁自行决定最终状态。
          if (patchSeq.get(roomId) === mine) {
            const revert: Partial<ChatPrefs> = {};
            for (const key of Object.keys(fields) as (keyof ChatPrefs)[]) (revert as Record<keyof ChatPrefs, unknown>)[key] = before[key];
            if (mark.pending === 0) prefsMarks.delete(roomId);
            else mark.fields = { ...mark.fields, ...revert };
            const current = get().data;
            if (current) set({ data: applyPrefsFields(current, roomId, revert) });
          }
          toast(errorMessage(error));
          void refresh({ force: true });
        }
      },
      markAllRead: async (roomId) => {
        const startGeneration = generation;
        get().markRoomRead(roomId);
        try {
          await api.markAllRead(roomId);
        } catch (error) {
          if (startGeneration !== generation) return;
          readMarks.delete(roomId);
          toast(errorMessage(error));
          void refresh({ force: true });
        }
      },
      setOffline: (offline) => {
        if (get().offline !== offline) set({ offline });
      },
      reset: () => {
        generation += 1;
        inflight = null;
        again = null;
        lastStartedAt = null;
        readMarks.clear();
        prefsMarks.clear();
        patchSeq.clear();
        set({ data: null, error: null, offline: false, syncing: false, loadedAt: null });
      },
    };
  });

  return store;
}

export type OverviewStore = ReturnType<typeof createOverviewStore>;

/**
 * Clears the store when the member signs out or another member signs in, and refetches when the
 * acting role changes, since that changes which channels are visible. Returns the unsubscribe function.
 * 成员退出或换了一个成员登录时清空 store；测试身份变化时重新加载，因为可见频道会随之改变。返回取消订阅的函数。
 */
export function bindOverviewToSession(store: OverviewStore): () => void {
  return useSessionStore.subscribe((state, prev) => {
    const signedOut = prev.token !== null && state.token === null;
    const switched = prev.member !== null && state.member !== null && prev.member.id !== state.member.id;
    if (signedOut || switched) {
      store.getState().reset();
      return;
    }
    // Channel access follows role and enrollment, so a change to either reloads the list.
    // 频道权限取决于身份和在读状态，任一变化都重新加载列表。
    const accessChanged = prev.member && state.member && (prev.member.role !== state.member.role || prev.member.enrollmentStatus !== state.member.enrollmentStatus);
    if (accessChanged) void store.getState().refresh({ force: true });
  });
}

export const useOverviewStore = createOverviewStore(chatApi);
bindOverviewToSession(useOverviewStore);
