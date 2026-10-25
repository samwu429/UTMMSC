/**
 * Owner: T3, timetable web core. The timetable store of timetable-final.md section 12, built from its dependencies
 * so tests can run it without a browser.
 * - Persisted through zustand persist under utmmsc.timetable.v1 with a storage whose reads are synchronous, so the
 *   home card has data on first paint. Another member's data is never read back, and everything is dropped when
 *   the member signs out or changes.
 * - Writes are applied at once (applyMutation), queued in the persisted outbox and sent one at a time. Success
 *   merges the server's item and rev; a rev other than the local one plus one means another device wrote, so the
 *   timetable is fetched again. A 4xx drops the write, fetches again and tells the member; a network failure or a
 *   5xx keeps it and tries again after 2 s, 5 s, 15 s, then every minute, and at once when the network or the page
 *   comes back.
 * - Fetches always send ?rev, at most every 30 s (10 min while the timetable is empty and its home card was
 *   dismissed) unless forced; every fresh answer has the outbox replayed over it.
 * 维护者：T3，课表网页核心。timetable-final.md 第 12 节的课表 store，由依赖项构建，因此测试无需浏览器即可运行。
 * - 通过 zustand persist 以 utmmsc.timetable.v1 保存，所用存储的读取是同步的，首页卡片因此在首次绘制时就有数据。
 *   绝不会读回其他成员的数据；成员退出登录或切换时清除全部内容。
 * - 写入立即应用（applyMutation），放入保存的发送队列，并逐条发送。成功后合并服务器返回的条目和 rev；rev 不等于本地 rev 加一，
 *   说明另一台设备写入过，因此重新获取课表。4xx 会丢弃这次写入、重新获取并提示成员；网络失败或 5xx 会保留写入，
 *   在 2 秒、5 秒、15 秒后重试，之后每分钟一次，网络或页面恢复时立即重试。
 * - 获取时总是带上 ?rev，除非强制，最多每 30 秒一次（课表为空且首页卡片已关闭时为 10 分钟）；每次得到新应答都会在其上重放队列。
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type {
  DeleteTimetableItemResponse,
  ImportTimetableBody,
  ImportTimetableCounts,
  ImportTimetableResponse,
  SaveAssignmentBody,
  SaveAssignmentResponse,
  SaveCourseBody,
  SaveCourseResponse,
  SaveTermBody,
  SaveTermResponse,
  SetSkipBody,
  SetSkipResponse,
  TimetableLocale,
  TimetableResponse,
  TimetableUnchanged,
  TimetableWriteResponse,
  UpdateTimetableSettingsBody,
  UpdateTimetableSettingsResponse,
} from '@utmmsc/shared';
import type { SyncStateStorage } from '../../chat/state/safeStorage';
import { applyMutation, applyOutbox, emptySnapshot, mergeServerItem } from './applyMutation';
import { enqueue, isPermanentFailure, retryDelayMs } from './outbox';
import { cleanPersisted } from './persisted';
import type { PersistedTimetable, TimetableMutation, TimetableOutboxItem, TimetableState } from './types';

export const TIMETABLE_STORAGE_KEY = 'utmmsc.timetable.v1';
/** Fetches closer together than this are skipped unless forced. */
/** 间隔短于此的获取会被跳过，除非强制。 */
export const REFRESH_THROTTLE_MS = 30_000;
/** The throttle while the timetable is empty and the home card's empty state was dismissed. */
/** 课表为空且首页卡片的空状态已关闭时的间隔。 */
export const EMPTY_REFRESH_THROTTLE_MS = 10 * 60_000;

/** The routes the store calls (timetableApi in production). */
/** store 调用的接口（正式环境为 timetableApi）。 */
export interface TimetableApiPort {
  get(rev?: number): Promise<TimetableResponse | TimetableUnchanged>;
  saveCourse(body: SaveCourseBody): Promise<SaveCourseResponse>;
  deleteCourse(id: string): Promise<DeleteTimetableItemResponse>;
  saveTerm(body: SaveTermBody): Promise<SaveTermResponse>;
  deleteTerm(id: string): Promise<DeleteTimetableItemResponse>;
  saveAssignment(body: SaveAssignmentBody): Promise<SaveAssignmentResponse>;
  setAssignmentDone(id: string, done: boolean): Promise<SaveAssignmentResponse>;
  deleteAssignment(id: string): Promise<DeleteTimetableItemResponse>;
  setSkip(body: SetSkipBody): Promise<SetSkipResponse>;
  updateSettings(body: UpdateTimetableSettingsBody): Promise<UpdateTimetableSettingsResponse>;
  importAll(body: ImportTimetableBody): Promise<ImportTimetableResponse>;
  clear(): Promise<DeleteTimetableItemResponse>;
}

export interface TimetableStoreDeps {
  api: TimetableApiPort;
  storage: SyncStateStorage;
  now: () => number;
  /** The signed-in member's id, or null when signed out. */
  /** 当前登录成员的 id；未登录时为 null。 */
  currentMember: () => string | null;
  onMemberChange: (listener: (memberId: string | null) => void) => () => void;
  /** The app's language, which timetable pushes follow. */
  /** App 的语言，课表推送随之使用。 */
  appLocale: () => TimetableLocale;
  onLocaleChange: (listener: () => void) => () => void;
  isOnline: () => boolean;
  /** Calls back when the page is shown again or the network returns. Installed on first use. */
  /** 页面重新显示或网络恢复时回调。首次使用时安装。 */
  onWake: (listener: () => void) => () => void;
  /** Tells the member that the server refused a write. */
  /** 告诉成员服务器拒绝了一次写入。 */
  report: (error: unknown) => void;
  newId: () => string;
}

export interface TimetableActions {
  refresh(options?: { force?: boolean }): Promise<void>;
  saveCourse(body: SaveCourseBody): void;
  deleteCourse(id: string): void;
  saveTerm(body: SaveTermBody): void;
  deleteTerm(id: string): void;
  saveAssignment(body: SaveAssignmentBody): void;
  setAssignmentDone(id: string, done: boolean): void;
  deleteAssignment(id: string): void;
  setSkip(body: SetSkipBody): void;
  updateSettings(patch: UpdateTimetableSettingsBody): void;
  importAll(body: ImportTimetableBody): Promise<ImportTimetableCounts>;
  clearAll(): Promise<void>;
  /** Sends what is queued now; resolves when the queue is empty or waiting for a retry. */
  /** 立即发送排队的内容；队列清空或进入等待重试时完成。 */
  flush(): Promise<void>;
  /** Stops timers and listeners (tests). */
  /** 停止计时器和监听（测试用）。 */
  dispose(): void;
}

function isUnchanged(response: TimetableResponse | TimetableUnchanged): response is TimetableUnchanged {
  return 'unchanged' in response && response.unchanged === true;
}

function isEmpty(snapshot: TimetableResponse | null): boolean {
  return !snapshot || (snapshot.courses.length === 0 && snapshot.terms.length === 0 && snapshot.assignments.length === 0);
}

function send(api: TimetableApiPort, mutation: TimetableMutation): Promise<TimetableWriteResponse<unknown>> {
  switch (mutation.kind) {
    case 'saveCourse':
      return api.saveCourse(mutation.body);
    case 'deleteCourse':
      return api.deleteCourse(mutation.id);
    case 'saveTerm':
      return api.saveTerm(mutation.body);
    case 'deleteTerm':
      return api.deleteTerm(mutation.id);
    case 'saveAssignment':
      return api.saveAssignment(mutation.body);
    case 'setAssignmentDone':
      return api.setAssignmentDone(mutation.id, mutation.done);
    case 'deleteAssignment':
      return api.deleteAssignment(mutation.id);
    case 'setSkip':
      return api.setSkip(mutation.body);
    case 'updateSettings':
      return api.updateSettings(mutation.patch);
    case 'clear':
      return api.clear();
  }
}

export function createTimetableStore(deps: TimetableStoreDeps) {
  /** Bumped on every reset, so answers to requests from before a sign-out or member switch are thrown away. */
  /** 每次重置时加一，退出登录或切换成员之前发出的请求的应答因此会被丢弃。 */
  let generation = 0;
  let sendingId: string | null = null;
  let flushing: Promise<void> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let fetching: Promise<void> | null = null;
  let fetchAgain = false;
  /**
   * The next fetch leaves out ?rev. A refused write changed nothing on the server, so its rev still matches and
   * only a full answer takes the refused change off the screen.
   * 下一次获取不带 ?rev。被拒绝的写入没有改变服务器上的任何内容，rev 仍然相同，只有完整的应答才能把被拒绝的修改从屏幕上撤下。
   */
  let fullNext = false;
  let lastFetchAt = Number.NEGATIVE_INFINITY;
  let dropped = false;
  /**
   * The highest rev a write answered with while the current fetch was on its way, 0 when none did. Fetches run one at
   * a time and each starts it from 0; every write bumps the rev, so an answer with a lower rev predates that write.
   * 当前获取在途期间写入应答的最高 rev，没有时为 0。获取一次只进行一个，每次从 0 开始；每次写入都会让 rev 加一，
   * 因此 rev 更低的应答早于那次写入。
   */
  let fetchWriteRev = 0;
  let stops: (() => void)[] = [];
  let started = false;

  const initial: PersistedTimetable = { memberId: null, snapshot: null, outbox: [], dismissedEmpty: false };

  const useStore = create<TimetableState>()(
    persist(
      (set) => ({
        ...initial,
        stalled: false,
        setDismissedEmpty: (value) => set({ dismissedEmpty: value }),
      }),
      {
        name: TIMETABLE_STORAGE_KEY,
        version: 1,
        storage: createJSONStorage(() => deps.storage),
        partialize: (state): PersistedTimetable => ({ memberId: state.memberId, snapshot: state.snapshot, outbox: state.outbox, dismissedEmpty: state.dismissedEmpty }),
        merge: (persisted, current) => {
          const member = deps.currentMember();
          const clean = cleanPersisted(persisted);
          if (member === null || clean.memberId !== member) {
            // Another member's timetable, or one left after signing out, is never shown and is overwritten below.
            // 另一位成员的课表，或退出登录后遗留的课表，绝不会显示，并在下面被覆盖。
            dropped = clean.memberId !== null || clean.snapshot !== null || clean.outbox.length > 0;
            return { ...current, ...initial, memberId: member };
          }
          return { ...current, ...clean };
        },
      },
    ),
  );
  if (dropped) useStore.setState({});

  const get = () => useStore.getState();

  function clearRetry() {
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = null;
  }

  function reset(memberId: string | null) {
    generation += 1;
    clearRetry();
    sendingId = null;
    flushing = null;
    fetching = null;
    fetchAgain = false;
    fullNext = false;
    lastFetchAt = Number.NEGATIVE_INFINITY;
    useStore.setState({ ...initial, memberId, stalled: false });
  }

  function start() {
    if (started) return;
    started = true;
    stops.push(
      deps.onWake(() => {
        // Back on screen or online: retry at once instead of waiting out the backoff.
        // 回到前台或恢复联网：立即重试，不再等待退避时间。
        clearRetry();
        void flush();
        void refresh();
      }),
    );
    stops.push(deps.onLocaleChange(() => syncLocale()));
  }

  /**
   * Timetable pushes use the app's language, so a change of language is saved with the settings. An empty
   * timetable has nothing to remind, so merely opening the app writes nothing; the first course or assignment
   * brings the language along.
   * 课表推送使用 App 的语言，因此语言变化会随设置保存。空课表没有可提醒的内容，所以仅仅打开 App 不会写入；
   * 添加第一门课或第一项作业时会一并保存语言。
   */
  function syncLocale() {
    const { snapshot, outbox } = get();
    if (!snapshot || (snapshot.courses.length === 0 && snapshot.assignments.length === 0)) return;
    const locale = deps.appLocale();
    if (snapshot.settings.locale === locale) return;
    const queued = outbox.some((item) => item.mutation.kind === 'updateSettings' && item.mutation.patch.locale === locale);
    if (!queued) mutate({ kind: 'updateSettings', patch: { locale } });
  }

  function mutate(mutation: TimetableMutation) {
    start();
    const state = get();
    if (state.memberId === null) return;
    const queuedAt = deps.now();
    const before = state.snapshot ?? emptySnapshot();
    const snapshot = applyMutation(before, mutation, queuedAt);
    const outbox = enqueue(state.outbox, mutation, { id: deps.newId(), queuedAt, sendingId, before });
    useStore.setState({ snapshot, outbox });
    if (mutation.kind !== 'updateSettings') syncLocale();
    void flush();
  }

  function finishSend(item: TimetableOutboxItem, response: TimetableWriteResponse<unknown>) {
    fetchWriteRev = Math.max(fetchWriteRev, response.rev);
    const state = get();
    const outbox = state.outbox.filter((queued) => queued.id !== item.id);
    let snapshot = state.snapshot;
    let refetch = false;
    if (snapshot) {
      const merged = mergeServerItem(snapshot, item.mutation, response.item);
      // Later writes to the same item are replayed over the server's copy, so they stay visible.
      // 对同一条目的后续写入会在服务器的副本上重放，因此仍然可见。
      snapshot = merged === snapshot ? snapshot : applyOutbox(merged, outbox);
      const rev = snapshot.rev;
      if (response.rev === rev + 1) snapshot = { ...snapshot, rev: response.rev };
      else if (response.rev > rev + 1) refetch = true;
    }
    useStore.setState({ outbox, snapshot, stalled: false });
    if (refetch) void refresh({ force: true });
  }

  function dropRefused(item: TimetableOutboxItem, error: unknown) {
    const outbox = get().outbox.filter((queued) => queued.id !== item.id);
    useStore.setState({ outbox, stalled: false });
    deps.report(error);
    // The refused write is still on screen; the server's full answer, with the rest of the queue, replaces it.
    // 被拒绝的写入仍显示在屏幕上；服务器的完整应答加上队列中其余写入会替换它。
    fullNext = true;
    void refresh({ force: true });
  }

  function keepForRetry(item: TimetableOutboxItem) {
    const outbox = get().outbox.map((queued) => (queued.id === item.id ? { ...queued, attempts: queued.attempts + 1 } : queued));
    useStore.setState({ outbox, stalled: true });
    const attempts = outbox.find((queued) => queued.id === item.id)?.attempts ?? 1;
    clearRetry();
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void flush();
    }, retryDelayMs(attempts));
  }

  async function drain(run: number) {
    while (run === generation) {
      const head = get().outbox[0];
      if (!head || get().memberId === null) return;
      if (retryTimer !== null) return;
      if (!deps.isOnline()) {
        useStore.setState({ stalled: true });
        return;
      }
      const item: TimetableOutboxItem = head.id ? head : { ...head, id: deps.newId() };
      if (!head.id) useStore.setState({ outbox: get().outbox.map((queued) => (queued === head ? item : queued)) });
      sendingId = item.id ?? null;
      try {
        const response = await send(deps.api, item.mutation);
        if (run !== generation) return;
        sendingId = null;
        finishSend(item, response);
      } catch (error) {
        if (run !== generation) return;
        sendingId = null;
        if (isPermanentFailure(error)) {
          dropRefused(item, error);
          continue;
        }
        keepForRetry(item);
        return;
      }
    }
  }

  function flush(): Promise<void> {
    start();
    if (flushing) return flushing;
    const run = generation;
    const current = drain(run).finally(() => {
      if (flushing === current) flushing = null;
    });
    flushing = current;
    return current;
  }

  async function fetchOnce(run: number) {
    const before = get();
    const memberId = before.memberId;
    if (memberId === null) return;
    const full = fullNext;
    fullNext = false;
    fetchWriteRev = 0;
    try {
      const response = await deps.api.get(full ? undefined : before.snapshot?.rev);
      if (run !== generation || get().memberId !== memberId) return;
      const state = get();
      if (isUnchanged(response)) {
        if (state.snapshot && state.snapshot.remindersAllowed !== response.remindersAllowed) {
          useStore.setState({ snapshot: { ...state.snapshot, remindersAllowed: response.remindersAllowed } });
        }
      } else if (response.rev >= fetchWriteRev) {
        // The answer is the truth, even with a lower rev than the device remembers (the data was restored), unless a
        // write came back with a higher rev while it was on its way: the answer predates that write and would drop it
        // from the screen (the write has left the queue), so it is fetched again.
        // 应答就是事实，即使它的 rev 比设备记得的更低（数据被恢复过）；除非在应答返回途中有写入以更高的 rev 完成：
        // 此时应答早于那次写入，会把它从屏幕上撤下（这次写入已离开队列），因此重新获取。
        useStore.setState({ snapshot: applyOutbox(response, state.outbox) });
      } else {
        fetchAgain = true;
      }
      syncLocale();
    } catch {
      // A failed fetch is tried again on the next wake-up rather than waiting out the throttle.
      // 获取失败时，下一次唤醒就会重试，而不必等待间隔。
      if (run === generation) {
        lastFetchAt = Number.NEGATIVE_INFINITY;
        fullNext ||= full;
      }
    }
  }

  function refresh(options: { force?: boolean } = {}): Promise<void> {
    start();
    const state = get();
    if (state.memberId === null) return Promise.resolve();
    if (fetching) {
      if (options.force) fetchAgain = true;
      return fetching;
    }
    const throttle = state.dismissedEmpty && isEmpty(state.snapshot) ? EMPTY_REFRESH_THROTTLE_MS : REFRESH_THROTTLE_MS;
    const now = deps.now();
    if (!options.force && now - lastFetchAt < throttle) {
      if (state.outbox.length > 0) void flush();
      return Promise.resolve();
    }
    lastFetchAt = now;
    const run = generation;
    const current = (async () => {
      await fetchOnce(run);
      while (fetchAgain && run === generation) {
        fetchAgain = false;
        lastFetchAt = deps.now();
        await fetchOnce(run);
      }
    })().finally(() => {
      if (fetching === current) fetching = null;
      if (run === generation && get().outbox.length > 0) void flush();
    });
    fetching = current;
    return current;
  }

  async function importAll(body: ImportTimetableBody): Promise<ImportTimetableCounts> {
    start();
    const run = generation;
    const response = await deps.api.importAll(body);
    if (run === generation) await refresh({ force: true });
    return response.item;
  }

  async function clearAll(): Promise<void> {
    mutate({ kind: 'clear' });
    await flush();
  }

  stops.push(
    deps.onMemberChange((memberId) => {
      if (memberId !== get().memberId) reset(memberId);
    }),
  );

  const actions: TimetableActions = {
    refresh,
    saveCourse: (body) => mutate({ kind: 'saveCourse', body }),
    deleteCourse: (id) => mutate({ kind: 'deleteCourse', id }),
    saveTerm: (body) => mutate({ kind: 'saveTerm', body }),
    deleteTerm: (id) => mutate({ kind: 'deleteTerm', id }),
    saveAssignment: (body) => mutate({ kind: 'saveAssignment', body }),
    setAssignmentDone: (id, done) => mutate({ kind: 'setAssignmentDone', id, done }),
    deleteAssignment: (id) => mutate({ kind: 'deleteAssignment', id }),
    setSkip: (body) => mutate({ kind: 'setSkip', body }),
    updateSettings: (patch) => mutate({ kind: 'updateSettings', patch }),
    importAll,
    clearAll,
    flush,
    dispose: () => {
      generation += 1;
      clearRetry();
      for (const stop of stops) stop();
      stops = [];
      started = false;
    },
  };

  return { useStore, actions };
}

export type TimetableStore = ReturnType<typeof createTimetableStore>;
