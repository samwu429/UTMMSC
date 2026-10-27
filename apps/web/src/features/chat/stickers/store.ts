import {
  STICKERS_PER_MEMBER_MAX,
  isStickerId,
  normalizeStickerRef,
  type StickerAddResponse,
  type StickerItem,
  type StickerRef,
} from '@utmmsc/shared';
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { holdAppUpdate } from '../../../app/pwa';
import { ApiClientError, errorMessage } from '../../../shared/api/errors';
import { tr } from '../../../shared/i18n/locale';
import { useSessionStore } from '../../../shared/session/store';
import { dismissSnackbar } from '../../../shared/ui/snackbar';
import { toast } from '../../../shared/ui/toast';
import { safeLocalStorage, type SyncStateStorage } from '../state/safeStorage';
import { stickerApi, type StickerApi } from './api';
import { prepareSticker, stickerProblemText, type PreparedSticker } from './prep';
import { uploadSticker } from './upload';

/**
 * The member's sticker collection (我的表情) on this device: the list from the server, kept in localStorage so the
 * panel opens at once and offline; the upload tiles of a pick; the stickers sent most recently from this device; and
 * the panel's last tab. Local changes show at once and win over any list that started before them, so a slow list
 * never undoes an add, a move or a removal.
 * 本设备上成员的表情列表（我的表情）：来自服务端的列表，保存在 localStorage 中，面板因此能立即打开，离线时也能打开；一次选择产生的上传图块；
 * 本设备最近发送的表情；以及面板上次停留的标签。本地改动立即生效，并且优先于在它之前发出的任何列表请求，慢一步的列表不会撤销添加、移动或删除。
 */

export const STICKERS_STORAGE_KEY = 'utmmsc.chat.stickers.v1';
/** A list fetched this long ago is fetched again, sending the version held so an unchanged list costs nothing. */
/** 列表获取超过这么久后重新获取；请求附带当前版本，列表未变时不产生开销。 */
export const STICKER_LIST_FRESH_MS = 5 * 60_000;
/** Stickers kept in 最近使用, most recent first. */
/** 「最近使用」保留的表情数，最近的在前。 */
export const STICKER_RECENT_MAX = 24;

export type StickerTab = 'emoji' | 'stickers';

export type StickerAddOutcome =
  | { kind: 'added'; sticker: StickerItem }
  | { kind: 'duplicate'; sticker: StickerItem }
  // Refused for good, no tile left to retry: full, daily, club, storage (a batch stops here), blocked (this file only).
  // 被最终拒绝，不留可重试的图块：已满、当日上限、全会上限、存储上限（一批上传到此为止），已封禁（只涉及这个文件）。
  | { kind: 'limit'; message: string }
  | { kind: 'failed'; message: string };

export interface StickerUploadTile {
  localId: string;
  /** The still being uploaded, once prepared. */
  /** 准备好之后，正在上传的静态图。 */
  previewUrl: string | null;
  /** 0 to 1. */
  /** 0 到 1。 */
  progress: number;
  status: 'preparing' | 'queued' | 'uploading' | 'failed';
  /** Why a failed tile failed, localized; the title of its sheet. */
  /** 失败图块的失败原因（已翻译），用作其操作表的标题。 */
  failure: string | null;
}

export interface StickerLibraryState {
  memberId: string | null;
  items: StickerItem[];
  max: number;
  /** The server version `items` match; null before the first list. */
  /** `items` 对应的服务端版本；第一次获取列表之前为 null。 */
  version: number | null;
  /** 'ready' whenever there is a list to show, the saved one included; 'loading' and 'error' only without one. */
  /** 只要有可显示的列表（包括已保存的）就是 'ready'；只有在没有列表时才会是 'loading' 和 'error'。 */
  status: 'idle' | 'loading' | 'ready' | 'error';
  uploads: StickerUploadTile[];
  recent: string[];
  tab: StickerTab;
  ensureFresh(): Promise<void>;
  has(id: string): boolean;
  addFiles(files: readonly Blob[], options?: { onPrepared?(problems: readonly string[]): void }): Promise<StickerAddOutcome[]>;
  retryUpload(localId: string): void;
  dropUpload(localId: string): void;
  addSticker(ref: StickerRef): Promise<StickerAddOutcome>;
  moveToFront(ids: readonly string[]): Promise<boolean>;
  stageRemoval(ids: readonly string[]): string;
  undoRemoval(removalId: string): void;
  commitRemoval(removalId: string, options?: { keepalive?: boolean }): Promise<boolean>;
  commitAllRemovals(options?: { keepalive?: boolean }): void;
  pushRecent(id: string): void;
  setTab(tab: StickerTab): void;
  /** Forgets everything, for a sign-out or another member signing in. */
  /** 清空所有内容，用于退出登录或换另一位成员登录。 */
  reset(): void;
}

/** What the store calls; tests pass fakes. */
/** store 调用的接口；测试时传入替身。 */
export interface StickerLibraryDeps {
  api: Pick<StickerApi, 'list' | 'add' | 'front' | 'remove'>;
  upload: typeof uploadSticker;
  prepare(file: Blob): Promise<PreparedSticker>;
  storage: SyncStateStorage;
  now(): number;
  /**
   * Keeps a waiting app update from reloading the page (pwa.ts) and returns the release. A pick, an add, a move and a
   * removal live only in memory until the server has them, so a reload would lose them without a word.
   * 阻止等待中的应用更新重新加载页面（pwa.ts），并返回释放函数。选好的文件、添加、移动和删除在服务端收到之前只保存在内存中，
   * 重新加载会让它们无声无息地丢失。
   */
  holdUpdate(): () => void;
}

/** Server refusals no retry could change: the tile goes and the reason is said. */
/** 重试也无法改变结果的服务端拒绝：图块移除，并提示原因。 */
const LIMIT_CODES: ReadonlySet<string> = new Set([
  'sticker_full',
  'sticker_blocked',
  'sticker_daily_limit',
  'sticker_edit_limit',
  'sticker_club_limit',
  'sticker_storage_limit',
  'sticker_storage_full',
  'schema_pending',
  'storage_unavailable',
]);

/**
 * Of those, the refusals of one file (its bytes are blocked): the rest of the batch still goes. Every other one is a
 * cap that would refuse whatever comes after it, so the batch stops there.
 * 其中只针对单个文件的拒绝（它的字节已被封禁）：这一批的其余文件照常上传。其余的都是上限，之后的任何文件都会被拒绝，这一批因此到此为止。
 */
const FILE_REFUSAL_CODES: ReadonlySet<string> = new Set(['sticker_blocked']);

/** The outcome of a tile the member removed before it finished; nothing is said about it. */
/** 成员在完成前移除的图块的结果；不需要提示任何内容。 */
const WITHDRAWN: StickerAddOutcome = { kind: 'failed', message: '' };

const TABS: readonly StickerTab[] = ['emoji', 'stickers'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanItem(value: unknown): StickerItem | null {
  const ref = normalizeStickerRef(value);
  if (!ref || !isRecord(value) || typeof value.addedAt !== 'string') return null;
  return { ...ref, addedAt: value.addedAt };
}

/** Valid items without repeats, and whether anything had to be dropped. */
/** 去掉重复的有效条目，以及是否有内容被丢弃。 */
function cleanItems(values: readonly unknown[]): { items: StickerItem[]; dropped: boolean } {
  const items: StickerItem[] = [];
  const seen = new Set<string>();
  let dropped = false;
  for (const value of values) {
    const item = cleanItem(value);
    if (!item || seen.has(item.id)) {
      dropped = true;
      continue;
    }
    seen.add(item.id);
    items.push(item);
  }
  return { items, dropped };
}

interface Persisted {
  memberId: string | null;
  items: StickerItem[];
  max: number;
  version: number | null;
  recent: string[];
  tab: StickerTab;
}

const EMPTY: Persisted = { memberId: null, items: [], max: STICKERS_PER_MEMBER_MAX, version: null, recent: [], tab: 'emoji' };

/**
 * Rebuilds the saved state field by field, so a corrupted or hand-edited entry is dropped instead of crashing. A list
 * that lost an item keeps no version, so the next fetch is a full list.
 * 逐字段重建已保存的状态，损坏或被手动改过的条目会被丢弃，而不会导致崩溃。丢失了条目的列表不保留版本号，下一次获取因此是完整列表。
 */
export function cleanPersistedStickers(raw: string | null): Persisted {
  if (!raw) return EMPTY;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return EMPTY;
  }
  if (!isRecord(value)) return EMPTY;
  const memberId = typeof value.memberId === 'string' && value.memberId ? value.memberId : null;
  const { items, dropped } = cleanItems(Array.isArray(value.items) ? value.items : []);
  const max = typeof value.max === 'number' && Number.isInteger(value.max) && value.max > 0 ? value.max : STICKERS_PER_MEMBER_MAX;
  const versionOk = typeof value.version === 'number' && Number.isInteger(value.version) && value.version >= 0;
  const version = versionOk && !dropped && Array.isArray(value.items) && memberId ? (value.version as number) : null;
  const recent: string[] = [];
  if (Array.isArray(value.recent)) {
    for (const id of value.recent) {
      if (isStickerId(id) && !recent.includes(id)) recent.push(id);
      if (recent.length >= STICKER_RECENT_MAX) break;
    }
  }
  const tab = TABS.includes(value.tab as StickerTab) ? (value.tab as StickerTab) : 'emoji';
  return { memberId, items: memberId ? items : [], max, version, recent: memberId ? recent : [], tab };
}

const idSets = new WeakMap<readonly StickerItem[], Set<string>>();

function idsOf(items: readonly StickerItem[]): Set<string> {
  let ids = idSets.get(items);
  if (!ids) {
    ids = new Set(items.map((item) => item.id));
    idSets.set(items, ids);
  }
  return ids;
}

/**
 * `current` with the items the order of `before` knew put back in that order, and the ones it did not know (added
 * since) left in front.
 * 把 `current` 中 `before` 已知的条目恢复为 `before` 中的顺序，`before` 不知道的条目（之后新增的）留在最前。
 */
function inOrderOf(current: readonly StickerItem[], before: readonly StickerItem[]): StickerItem[] {
  const rank = new Map(before.map((item, i) => [item.id, i]));
  const fresh = current.filter((item) => !rank.has(item.id));
  const known = current.filter((item) => rank.has(item.id)).sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
  return [...fresh, ...known];
}

/**
 * Puts removed items back where they were: each right after the item that was above it in `before` and is still
 * here, so stickers moved or added meanwhile stay where they are. Those that were at the top go before the first
 * item `before` knew.
 * 把删除的条目放回原处：每个都放在 `before` 中位于它上方、并且仍然存在的那个条目之后，期间移动或新增的表情因此保持不动。
 * 原本位于最前面的条目放在 `before` 已知的第一个条目之前。
 */
export function restoreRemoved(current: readonly StickerItem[], before: readonly StickerItem[], back: readonly StickerItem[]): StickerItem[] {
  const returning = new Set(back.map((item) => item.id));
  const present = idsOf(current);
  const after = new Map<string | null, StickerItem[]>();
  let anchor: string | null = null;
  for (const item of before) {
    if (returning.has(item.id)) {
      if (present.has(item.id)) continue;
      const group = after.get(anchor) ?? [];
      group.push(item);
      after.set(anchor, group);
    } else if (present.has(item.id)) {
      anchor = item.id;
    }
  }
  const knew = idsOf(before);
  const result: StickerItem[] = [];
  let headPlaced = false;
  for (const item of current) {
    if (!headPlaced && knew.has(item.id)) {
      result.push(...(after.get(null) ?? []));
      headPlaced = true;
    }
    result.push(item);
    const group = after.get(item.id);
    if (group) result.push(...group);
  }
  if (!headPlaced) result.push(...(after.get(null) ?? []));
  return result;
}

function addedOutcome(res: StickerAddResponse): StickerAddOutcome {
  return res.duplicate ? { kind: 'duplicate', sticker: res.sticker } : { kind: 'added', sticker: res.sticker };
}

function failureOutcome(error: unknown): Extract<StickerAddOutcome, { message: string }> {
  const message = errorMessage(error);
  return error instanceof ApiClientError && LIMIT_CODES.has(error.code) ? { kind: 'limit', message } : { kind: 'failed', message };
}

/** Whether a refusal ends the whole batch, not only the file it answered. */
/** 这个拒绝是否结束整批上传，而不只是它所答复的那个文件。 */
function stopsBatch(error: unknown): boolean {
  return error instanceof ApiClientError && LIMIT_CODES.has(error.code) && !FILE_REFUSAL_CODES.has(error.code);
}

function revoke(url: string | null): void {
  if (!url) return;
  try {
    URL.revokeObjectURL(url);
  } catch {
    // Nothing to free where object URLs do not exist.
    // 没有对象 URL 的环境里无需释放。
  }
}

interface UploadJob {
  prepared: PreparedSticker | null;
  controller: AbortController | null;
}

interface Removal {
  items: StickerItem[];
  /** The order when it was staged, to put the items back where they were. */
  /** 暂存时的顺序，用于把条目放回原处。 */
  before: StickerItem[];
  committing: Promise<boolean> | null;
}

export function createStickerLibrary(overrides: Partial<StickerLibraryDeps> = {}): UseBoundStore<StoreApi<StickerLibraryState>> {
  const deps: StickerLibraryDeps = {
    api: overrides.api ?? stickerApi,
    upload: overrides.upload ?? uploadSticker,
    prepare: overrides.prepare ?? ((file) => prepareSticker(file)),
    storage: overrides.storage ?? safeLocalStorage,
    now: overrides.now ?? Date.now,
    holdUpdate: overrides.holdUpdate ?? holdAppUpdate,
  };

  /** Bumped by a reset: anything still running from before it changes nothing. */
  /** 每次重置时递增：重置之前仍在进行的操作不再改变任何内容。 */
  let generation = 0;
  /** Bumped by every local change and every settled move or removal; a list started before the latest one is dropped. */
  /** 每次本地改动以及每次移动或删除完成时递增；早于最近一次改动发出的列表会被丢弃。 */
  let mutationSeq = 0;
  /** Moves and removals the server has not answered yet; a list answered meanwhile is dropped. */
  /** 服务端尚未答复的移动和删除；期间返回的列表会被丢弃。 */
  let pending = 0;
  /** The list may differ from the server's; the next ensureFresh fetches whatever the time. */
  /** 列表可能与服务端不一致；下一次 ensureFresh 不论时间都会重新获取。 */
  let stale = false;
  /** Something asked for a fresh list this session, so a dropped list is fetched again on its own. */
  /** 本次会话中有界面请求过最新列表，被丢弃的列表因此会自动重新获取。 */
  let asked = false;
  let fetchedAt: number | null = null;
  let listJob: Promise<void> | null = null;
  let moveSeq = 0;
  let removalCounter = 0;
  let tileCounter = 0;
  let pageListeners = false;
  const adds = new Map<string, Promise<StickerAddOutcome>>();
  const removals = new Map<string, Removal>();
  const jobs = new Map<string, UploadJob>();
  /** Outcomes of tiles that went before their upload ran, for the batch waiting on them. */
  /** 在上传开始之前就已移除的图块的结果，供等待它们的那一批使用。 */
  const settled = new Map<string, StickerAddOutcome>();
  let uploadTail: Promise<unknown> = Promise.resolve();
  let releaseUpdate: (() => void) | null = null;

  /**
   * Holds back a waiting app update while work here is not done: a file being prepared, queued or uploaded, a removal
   * staged or on its way, a move or an add on its way. A failed tile waits for the member (重试 holds again); 移除, a
   * sign-out or a reset lets go.
   * 这里的工作没有完成时推迟等待中的应用更新：正在准备、排队或上传的文件，已暂存或正在发出的删除，正在发出的移动或添加。
   * 失败的图块等成员处理（「重试」会再次占用）；「移除」、退出登录或重置时释放。
   */
  function syncUpdateHold(uploads: readonly StickerUploadTile[]): void {
    const busy = pending > 0 || removals.size > 0 || adds.size > 0 || uploads.some((tile) => tile.status !== 'failed');
    if (busy && !releaseUpdate) {
      releaseUpdate = deps.holdUpdate();
    } else if (!busy && releaseUpdate) {
      const release = releaseUpdate;
      releaseUpdate = null;
      release();
    }
  }

  /**
   * Saves the collection. While a move or a removal is not settled the version is left out, so a page closed before
   * the server answered fetches a full list next time instead of trusting a list the server may not have.
   * 保存表情列表。移动或删除尚未完成时不保存版本号，这样在服务端答复前关闭页面的话，下次会获取完整列表，而不会信任服务端可能并不具有的列表。
   */
  function save(state: Persisted): void {
    const version = pending > 0 || removals.size > 0 ? null : state.version;
    const data: Persisted = { memberId: state.memberId, items: state.items, max: state.max, version, recent: state.recent, tab: state.tab };
    deps.storage.setItem(STICKERS_STORAGE_KEY, JSON.stringify(data));
  }

  const saved = cleanPersistedStickers(deps.storage.getItem(STICKERS_STORAGE_KEY));
  const sessionMember = useSessionStore.getState().member?.id ?? null;
  const initial = sessionMember && saved.memberId && saved.memberId !== sessionMember ? EMPTY : saved;

  const store = create<StickerLibraryState>()((set, get) => {
    function patchTile(localId: string, patch: Partial<StickerUploadTile>): void {
      const uploads = get().uploads;
      const index = uploads.findIndex((tile) => tile.localId === localId);
      const tile = uploads[index];
      if (!tile) return;
      const next = uploads.slice();
      next[index] = { ...tile, ...patch };
      set({ uploads: next });
    }

    function finishTile(localId: string): void {
      const tile = get().uploads.find((entry) => entry.localId === localId);
      revoke(tile?.previewUrl ?? null);
      jobs.delete(localId);
      if (tile) set({ uploads: get().uploads.filter((entry) => entry !== tile) });
    }

    function onPageHidden(event: Event): void {
      if (event.type === 'visibilitychange' && document.visibilityState !== 'hidden') return;
      get().commitAllRemovals({ keepalive: true });
    }

    /** Commits on pagehide and when the page is hidden, while anything is staged. */
    /** 有暂存的删除时，在 pagehide 和页面隐藏时提交。 */
    function updatePageListeners(): void {
      let want = false;
      for (const removal of removals.values()) if (!removal.committing) want = true;
      if (want === pageListeners || typeof window === 'undefined' || typeof document === 'undefined') return;
      pageListeners = want;
      if (want) {
        window.addEventListener('pagehide', onPageHidden);
        document.addEventListener('visibilitychange', onPageHidden);
      } else {
        window.removeEventListener('pagehide', onPageHidden);
        document.removeEventListener('visibilitychange', onPageHidden);
      }
    }

    function resetAll(): void {
      generation += 1;
      mutationSeq += 1;
      pending = 0;
      stale = false;
      asked = false;
      fetchedAt = null;
      listJob = null;
      adds.clear();
      removals.clear();
      settled.clear();
      for (const job of jobs.values()) job.controller?.abort();
      jobs.clear();
      for (const tile of get().uploads) revoke(tile.previewUrl);
      updatePageListeners();
      set({ ...EMPTY, status: 'idle', uploads: [] });
      syncUpdateHold([]);
    }

    /**
     * The signed-in member, taking over a collection saved without one, and starting afresh when the saved one is
     * someone else's.
     * 当前登录的成员：接管尚未归属任何成员的已保存列表；已保存的列表属于别人时重新开始。
     */
    function syncMember(): string | null {
      const session = useSessionStore.getState();
      const memberId = session.token ? (session.member?.id ?? null) : null;
      if (!memberId) return null;
      const current = get().memberId;
      if (current !== memberId) {
        if (current !== null) resetAll();
        set({ memberId });
      }
      return memberId;
    }

    function changed(): void {
      mutationSeq += 1;
    }

    function begin(): number {
      pending += 1;
      mutationSeq += 1;
      syncUpdateHold(get().uploads);
      return generation;
    }

    function end(startGeneration: number): void {
      if (startGeneration !== generation) return;
      pending = Math.max(0, pending - 1);
      mutationSeq += 1;
      syncUpdateHold(get().uploads);
      if (pending === 0) {
        save(get());
        refetchIfStale();
      }
    }

    function refetchIfStale(): void {
      if (stale && asked && pending === 0 && !listJob) void get().ensureFresh();
    }

    /**
     * Takes a version an add, move or removal answered with only when it follows the one held: anything else means
     * another device changed the collection too, and the next list fetches it.
     * 只有当添加、移动或删除答复的版本紧接在当前版本之后时才采用它：否则说明其他设备也改动了表情列表，下一次获取列表时再取回。
     */
    function adoptVersion(next: number): void {
      const current = get().version;
      if (current !== null && next === current + 1) set({ version: next });
      else if (current === null || next > current) stale = true;
    }

    function withoutRemoved(items: StickerItem[]): StickerItem[] {
      if (removals.size === 0) return items;
      const removed = new Set<string>();
      for (const removal of removals.values()) for (const item of removal.items) removed.add(item.id);
      return items.filter((item) => !removed.has(item.id));
    }

    function applyAdded(res: StickerAddResponse): void {
      const id = res.sticker.id;
      changed();
      for (const removal of removals.values()) {
        // Added again before its removal was sent: the removal leaves it alone.
        // 在删除发出之前又被添加：删除不再包括它。
        if (!removal.committing) removal.items = removal.items.filter((item) => item.id !== id);
        else if (removal.items.some((item) => item.id === id)) stale = true;
      }
      set({ items: [res.sticker, ...get().items.filter((item) => item.id !== id)] });
      adoptVersion(res.version);
      refetchIfStale();
    }

    function dropQueued(outcome: StickerAddOutcome): void {
      for (const tile of get().uploads) {
        if (tile.status !== 'queued') continue;
        settled.set(tile.localId, outcome);
        finishTile(tile.localId);
      }
    }

    function takeSettled(localId: string): StickerAddOutcome {
      const outcome = settled.get(localId) ?? WITHDRAWN;
      settled.delete(localId);
      return outcome;
    }

    async function runUpload(localId: string): Promise<StickerAddOutcome> {
      if (settled.has(localId)) return takeSettled(localId);
      const job = jobs.get(localId);
      if (!job?.prepared) return WITHDRAWN;
      const startGeneration = generation;
      const controller = new AbortController();
      job.controller = controller;
      patchTile(localId, { status: 'uploading', progress: 0, failure: null });
      try {
        const { body } = await deps.upload(job.prepared, { signal: controller.signal, onProgress: (fraction) => patchTile(localId, { progress: fraction }) });
        if (startGeneration !== generation) return addedOutcome(body);
        finishTile(localId);
        applyAdded(body);
        return addedOutcome(body);
      } catch (error) {
        if (startGeneration !== generation) return WITHDRAWN;
        if (controller.signal.aborted) {
          // The server may have stored it before the abort reached it.
          // 中止到达之前，服务端可能已经保存了它。
          stale = true;
          refetchIfStale();
          return takeSettled(localId);
        }
        const outcome = failureOutcome(error);
        if (outcome.kind === 'limit') {
          finishTile(localId);
          if (stopsBatch(error)) dropQueued(outcome);
        } else {
          job.controller = null;
          patchTile(localId, { status: 'failed', progress: 0, failure: outcome.message });
          if (!(error instanceof ApiClientError)) {
            // No answer came (the network failed or the upload stalled): the server may have stored it all the same.
            // 没有收到答复（网络失败或上传卡住）：服务端仍可能已经保存了它。
            stale = true;
            refetchIfStale();
          }
        }
        return outcome;
      }
    }

    /** Uploads run one at a time, in the order they were queued. */
    /** 上传按排队顺序逐个进行。 */
    function enqueue(localId: string): Promise<StickerAddOutcome> {
      const run = uploadTail.then(() => runUpload(localId));
      uploadTail = run.catch(() => undefined);
      return run;
    }

    return {
      ...initial,
      status: initial.version !== null || initial.items.length > 0 ? 'ready' : 'idle',
      uploads: [],

      ensureFresh: () => {
        if (!syncMember()) return Promise.resolve();
        asked = true;
        if (listJob) return listJob;
        if (!stale && fetchedAt !== null && deps.now() - fetchedAt < STICKER_LIST_FRESH_MS) return Promise.resolve();
        const startGeneration = generation;
        const startSeq = mutationSeq;
        const held = get().version;
        if (held === null && get().items.length === 0) set({ status: 'loading' });
        const job = deps.api.list(held ?? undefined).then(
          (res) => {
            if (startGeneration !== generation) return;
            listJob = null;
            useSessionStore.getState().setMediaToken(res.mediaToken);
            if (startSeq !== mutationSeq || pending > 0) {
              // A local change happened after this list was asked for; it may not include it.
              // 这个列表发出之后发生了本地改动，它可能没有包含该改动。
              stale = true;
              refetchIfStale();
              return;
            }
            stale = false;
            fetchedAt = deps.now();
            if (res.unchanged) {
              set({ max: res.max, version: res.version, status: 'ready' });
              return;
            }
            set({ items: withoutRemoved(cleanItems(res.stickers).items), max: res.max, version: res.version, status: 'ready' });
          },
          () => {
            if (startGeneration !== generation) return;
            listJob = null;
            // A saved list keeps showing; only without one does the panel say it could not load.
            // 已保存的列表继续显示；只有没有列表时，面板才提示加载失败。
            set({ status: get().version === null && get().items.length === 0 ? 'error' : 'ready' });
          },
        );
        listJob = job;
        return job;
      },

      has: (id) => idsOf(get().items).has(id),

      addFiles: async (files, options = {}) => {
        syncMember();
        const startGeneration = generation;
        const picks = files.map((file) => ({ file, localId: `upload-${(tileCounter += 1)}` }));
        for (const pick of picks) jobs.set(pick.localId, { prepared: null, controller: null });
        const tiles: StickerUploadTile[] = picks.map(({ localId }) => ({ localId, previewUrl: null, progress: 0, status: 'preparing', failure: null }));
        set({ uploads: [...tiles, ...get().uploads] });

        const outcomes: (StickerAddOutcome | null)[] = picks.map(() => null);
        const problems: string[] = [];
        // One at a time: decoding nine photos at once can run a phone out of memory.
        // 逐个处理：同时解码九张照片可能耗尽手机内存。
        for (const [index, pick] of picks.entries()) {
          if (startGeneration !== generation) break;
          if (!jobs.has(pick.localId)) {
            outcomes[index] = takeSettled(pick.localId);
            continue;
          }
          try {
            const prepared = await deps.prepare(pick.file);
            const job = jobs.get(pick.localId);
            if (startGeneration !== generation || !job) {
              revoke(prepared.previewUrl);
              outcomes[index] = takeSettled(pick.localId);
              continue;
            }
            job.prepared = prepared;
            patchTile(pick.localId, { status: 'queued', previewUrl: prepared.previewUrl });
          } catch (error) {
            const text = stickerProblemText(error, tr);
            outcomes[index] = { kind: 'failed', message: text };
            if (startGeneration === generation && jobs.has(pick.localId)) {
              problems.push(text);
              finishTile(pick.localId);
            } else {
              settled.delete(pick.localId);
            }
          }
        }
        if (startGeneration !== generation) return outcomes.map((outcome) => outcome ?? WITHDRAWN);
        options.onPrepared?.(problems);

        // Last picked first, so the finished grid shows them in the order picked.
        // 最后选的最先上传，完成后的格子因此按选择的顺序排列。
        const waits: Promise<void>[] = [];
        for (let index = picks.length - 1; index >= 0; index -= 1) {
          const pick = picks[index];
          if (!pick || outcomes[index]) continue;
          waits.push(
            enqueue(pick.localId).then((outcome) => {
              outcomes[index] = outcome;
            }),
          );
        }
        await Promise.all(waits);
        return outcomes.map((outcome) => outcome ?? WITHDRAWN);
      },

      retryUpload: (localId) => {
        const tile = get().uploads.find((entry) => entry.localId === localId);
        if (!tile || tile.status !== 'failed' || !jobs.get(localId)?.prepared) return;
        patchTile(localId, { status: 'queued', progress: 0, failure: null });
        void enqueue(localId).then((outcome) => {
          // Nobody waits on a retry, so a refusal that took the tile away (and a cap that dropped the queue) is said here.
          // 重试没有调用方在等待，因此移除了图块的拒绝（以及清空队列的上限）在这里提示。
          if (outcome.kind === 'limit') toast(outcome.message);
        });
      },

      dropUpload: (localId) => {
        const job = jobs.get(localId);
        const tile = get().uploads.find((entry) => entry.localId === localId);
        if (!job || !tile) return;
        if (tile.status !== 'failed') settled.set(localId, WITHDRAWN);
        job.controller?.abort();
        finishTile(localId);
      },

      addSticker: (ref) => {
        const running = adds.get(ref.id);
        if (running) return running;
        syncMember();
        const startGeneration = generation;
        const job = (async (): Promise<StickerAddOutcome> => {
          try {
            const res = await deps.api.add(ref.id, ref.thumb);
            if (startGeneration === generation) applyAdded(res);
            return addedOutcome(res);
          } catch (error) {
            return failureOutcome(error);
          }
        })();
        adds.set(ref.id, job);
        syncUpdateHold(get().uploads);
        void job.then(() => {
          if (adds.get(ref.id) === job) adds.delete(ref.id);
          syncUpdateHold(get().uploads);
        });
        return job;
      },

      moveToFront: async (ids) => {
        syncMember();
        const items = get().items;
        const byId = new Map(items.map((item) => [item.id, item]));
        const wanted: StickerItem[] = [];
        const moving = new Set<string>();
        for (const id of ids) {
          const item = byId.get(id);
          if (!item || moving.has(id)) continue;
          moving.add(id);
          wanted.push(item);
        }
        // Already the first ones in that order: nothing to send.
        // 已经按这个顺序排在最前：无需发送。
        if (wanted.every((item, i) => items[i] === item)) return true;
        const before = items;
        // Counted as pending before the order changes, so the order saved meanwhile carries no version.
        // 在顺序改变之前就计为待完成，期间保存的顺序因此不带版本号。
        const startGeneration = begin();
        moveSeq += 1;
        const mine = moveSeq;
        set({ items: [...wanted, ...items.filter((item) => !moving.has(item.id))] });
        try {
          const res = await deps.api.front(wanted.map((item) => item.id));
          if (startGeneration === generation) adoptVersion(res.version);
          return true;
        } catch (error) {
          if (startGeneration !== generation) return false;
          // Only the latest move puts the order back; an older one would undo the newer.
          // 只有最近一次移动才恢复顺序；较早的移动若恢复，会撤销较新的那一次。
          if (moveSeq === mine) set({ items: inOrderOf(get().items, before) });
          else stale = true;
          toast(errorMessage(error));
          return false;
        } finally {
          end(startGeneration);
        }
      },

      stageRemoval: (ids) => {
        syncMember();
        removalCounter += 1;
        const removalId = `removal-${removalCounter}`;
        const wanted = new Set(ids);
        const before = get().items;
        const items = before.filter((item) => wanted.has(item.id));
        removals.set(removalId, { items, before, committing: null });
        syncUpdateHold(get().uploads);
        if (items.length > 0) {
          changed();
          set({ items: before.filter((item) => !wanted.has(item.id)) });
        }
        updatePageListeners();
        return removalId;
      },

      undoRemoval: (removalId) => {
        const removal = removals.get(removalId);
        if (!removal || removal.committing) return;
        removals.delete(removalId);
        syncUpdateHold(get().uploads);
        const present = idsOf(get().items);
        const back = removal.items.filter((item) => !present.has(item.id));
        changed();
        if (back.length > 0) set({ items: restoreRemoved(get().items, removal.before, back) });
        else save(get());
        updatePageListeners();
      },

      commitRemoval: (removalId, options = {}) => {
        const removal = removals.get(removalId);
        if (!removal) return Promise.resolve(true);
        if (removal.committing) return removal.committing;
        const ids = removal.items.map((item) => item.id);
        if (ids.length === 0) {
          removals.delete(removalId);
          syncUpdateHold(get().uploads);
          updatePageListeners();
          save(get());
          return Promise.resolve(true);
        }
        const startGeneration = begin();
        const job = (async (): Promise<boolean> => {
          try {
            const res = await deps.api.remove(ids, { keepalive: options.keepalive === true });
            if (startGeneration !== generation) return true;
            removals.delete(removalId);
            adoptVersion(res.version);
            return true;
          } catch (error) {
            if (startGeneration !== generation) return false;
            removals.delete(removalId);
            const present = idsOf(get().items);
            const back = removal.items.filter((item) => !present.has(item.id));
            changed();
            if (back.length > 0) set({ items: restoreRemoved(get().items, removal.before, back) });
            toast(errorMessage(error));
            return false;
          } finally {
            end(startGeneration);
            updatePageListeners();
          }
        })();
        removal.committing = job;
        updatePageListeners();
        return job;
      },

      commitAllRemovals: (options = {}) => {
        let any = false;
        for (const [removalId, removal] of [...removals]) {
          if (removal.committing) continue;
          any = true;
          void get().commitRemoval(removalId, options);
        }
        // The undo is never offered for a removal already sent; its onClose then finds nothing left to commit.
        // 已经发出的删除不再提供「撤销」；提示条的 onClose 随后也不会再有需要提交的内容。
        if (any) dismissSnackbar();
      },

      pushRecent: (id) => {
        if (!isStickerId(id)) return;
        syncMember();
        const recent = get().recent;
        if (recent[0] === id) return;
        set({ recent: [id, ...recent.filter((entry) => entry !== id)].slice(0, STICKER_RECENT_MAX) });
      },

      setTab: (tab) => {
        if (get().tab !== tab && TABS.includes(tab)) set({ tab });
      },

      reset: resetAll,
    };
  });

  store.subscribe((state, prev) => {
    if (
      state.memberId !== prev.memberId ||
      state.items !== prev.items ||
      state.max !== prev.max ||
      state.version !== prev.version ||
      state.recent !== prev.recent ||
      state.tab !== prev.tab
    ) {
      save(state);
    }
    if (state.uploads !== prev.uploads) syncUpdateHold(state.uploads);
  });

  return store;
}

export type StickerLibraryStore = ReturnType<typeof createStickerLibrary>;

const recentCache = new WeakMap<readonly StickerItem[], { recent: readonly string[]; result: StickerItem[] }>();

/**
 * 最近使用: the stickers sent most recently from this device that are still in the collection, most recent first.
 * The same array comes back while neither list changes, so it is safe in a selector.
 * 「最近使用」：本设备最近发送、并且仍在表情列表中的表情，最近的在前。两份列表都不变时返回同一个数组，可直接用于选择器。
 */
export function recentStickers(state: Pick<StickerLibraryState, 'items' | 'recent'>): StickerItem[] {
  const cached = recentCache.get(state.items);
  if (cached && cached.recent === state.recent) return cached.result;
  const byId = new Map(state.items.map((item) => [item.id, item]));
  const result: StickerItem[] = [];
  for (const id of state.recent) {
    const item = byId.get(id);
    if (item) result.push(item);
  }
  recentCache.set(state.items, { recent: state.recent, result });
  return result;
}

/** Clears the store when the signed-in member signs out or changes. Returns the unsubscribe function. */
/** 当前登录成员退出或切换时清空 store。返回取消订阅的函数。 */
export function bindStickersToSession(store: StickerLibraryStore): () => void {
  return useSessionStore.subscribe((state, prev) => {
    const signedOut = prev.token !== null && state.token === null;
    const switched = prev.member !== null && state.member !== null && prev.member.id !== state.member.id;
    if (signedOut || switched) store.getState().reset();
  });
}

export const useStickerLibrary: UseBoundStore<StoreApi<StickerLibraryState>> = createStickerLibrary();
bindStickersToSession(useStickerLibrary);
