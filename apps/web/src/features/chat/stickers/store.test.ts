import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemberSelf, StickerAddResponse, StickerItem, StickerListResponse } from '@utmmsc/shared';
import { createUpdateHolds } from '../../../app/pwa';
import { ApiClientError } from '../../../shared/api/errors';
import { useSessionStore } from '../../../shared/session/store';
import { dismissSnackbar } from '../../../shared/ui/snackbar';
import { toast } from '../../../shared/ui/toast';
import { createSafeStorage } from '../state/safeStorage';
import { StickerPrepError, type PreparedSticker } from './prep';
import {
  STICKERS_STORAGE_KEY,
  STICKER_LIST_FRESH_MS,
  STICKER_RECENT_MAX,
  bindStickersToSession,
  createStickerLibrary,
  recentStickers,
  restoreRemoved,
  type StickerLibraryDeps,
} from './store';
import { uploadSticker } from './upload';

vi.mock('./upload', () => ({ uploadSticker: vi.fn() }));
vi.mock('../../../shared/ui/toast', () => ({ toast: vi.fn() }));
vi.mock('../../../shared/ui/snackbar', () => ({ dismissSnackbar: vi.fn() }));

const upload = vi.mocked(uploadSticker);

function stickerId(n: number): string {
  return `stk_${String(n).padStart(22, '0')}`;
}

function item(n: number, overrides: Partial<StickerItem> = {}): StickerItem {
  return { id: stickerId(n), type: 'gif', width: 100, height: 100, animated: false, bytes: 1000 + n, thumb: 'T'.repeat(22), addedAt: `2026-10-${String(n % 28 + 1).padStart(2, '0')}T00:00:00.000Z`, ...overrides };
}

const ids = (items: readonly StickerItem[]) => items.map((entry) => entry.id);

function memoryStorage() {
  const data = new Map<string, string>();
  const storage = createSafeStorage(() => ({
    getItem: (name: string) => data.get(name) ?? null,
    setItem: (name: string, value: string) => void data.set(name, value),
    removeItem: (name: string) => void data.delete(name),
  }));
  return { data, storage };
}

interface Call<T> {
  args: unknown[];
  resolve(value: T): void;
  reject(error: unknown): void;
}

/** A stand-in whose calls the test answers one by one. */
/** 由测试逐个答复各次调用的替身。 */
function controllable<T>() {
  const calls: Call<T>[] = [];
  const fn = vi.fn(
    (...args: unknown[]) =>
      new Promise<T>((resolve, reject) => {
        calls.push({ args, resolve, reject });
      }),
  );
  return { fn, calls };
}

function fakeApi() {
  const list = controllable<StickerListResponse>();
  const add = controllable<StickerAddResponse>();
  const front = controllable<{ moved: number; version: number }>();
  const remove = controllable<{ removed: number; total: number; version: number }>();
  const api = { list: list.fn, add: add.fn, front: front.fn, remove: remove.fn } as unknown as StickerLibraryDeps['api'];
  return { api, list, add, front, remove };
}

const listed = (stickers: StickerItem[], version: number): StickerListResponse => ({ stickers, max: 999, version, mediaToken: 'media-1' });

function prepared(n: number, overrides: Partial<PreparedSticker> = {}): PreparedSticker {
  return {
    file: new Blob([new Uint8Array(n)]),
    thumb: new Blob([Uint8Array.from([n, n])]),
    sha256: String(n).padStart(64, '0'),
    thumbSha256: String(n).padStart(64, '1'),
    type: 'gif',
    width: 100,
    height: 100,
    animated: false,
    bytes: 1,
    previewUrl: `blob:preview-${n}`,
    ...overrides,
  };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** An XMLHttpRequest for the real uploadSticker that sends nothing and answers only when the test says so. */
/** 供真实 uploadSticker 使用的 XMLHttpRequest 替身：不发送任何内容，只在测试指定时答复。 */
class SilentXhr {
  static all: SilentXhr[] = [];
  status = 0;
  responseText = '';
  upload: { onprogress: (() => void) | null; onload: (() => void) | null } = { onprogress: null, onload: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  constructor() {
    SilentXhr.all.push(this);
  }
  open() {}
  setRequestHeader() {}
  getResponseHeader() {
    return 'application/json';
  }
  send() {}
  abort() {
    this.onabort?.();
  }
  respond(status: number, body: unknown) {
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.onload?.();
  }
}

function signIn(id = 'mem_a') {
  useSessionStore.setState({ token: `tok-${id}`, member: { id } as MemberSelf, mediaToken: null });
}

/** A store already holding [1, 2, 3] at version 5, fetched just now. */
/** 已持有 [1, 2, 3]、版本为 5、刚刚获取过列表的 store。 */
async function loaded(extra: Partial<StickerLibraryDeps> = {}) {
  const fake = fakeApi();
  const { data, storage } = memoryStorage();
  const holds = createUpdateHolds();
  const holdUpdate = vi.fn(() => holds.take());
  let now = 1_000_000;
  const store = createStickerLibrary({ api: fake.api, storage, now: () => now, prepare: async () => prepared(0), holdUpdate, ...extra });
  const ready = store.getState().ensureFresh();
  fake.list.calls[0]?.resolve(listed([item(1), item(2), item(3)], 5));
  await ready;
  return { store, fake, data, storage, holds, holdUpdate, advance: (ms: number) => (now += ms) };
}

beforeEach(() => {
  signIn();
  upload.mockReset();
  vi.mocked(toast).mockClear();
  vi.mocked(dismissSnackbar).mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  useSessionStore.setState({ token: null, member: null, mediaToken: null });
});

describe('sticker library: list and persistence', () => {
  it('fetches the list, keeps the media token, and saves it for the next start', async () => {
    const { store, data, storage } = await loaded();
    expect(ids(store.getState().items)).toEqual([stickerId(1), stickerId(2), stickerId(3)]);
    expect(store.getState()).toMatchObject({ status: 'ready', version: 5, max: 999, memberId: 'mem_a' });
    expect(useSessionStore.getState().mediaToken).toBe('media-1');
    expect(data.has(STICKERS_STORAGE_KEY)).toBe(true);

    const reopened = createStickerLibrary({ api: fakeApi().api, storage });
    expect(reopened.getState()).toMatchObject({ status: 'ready', version: 5, memberId: 'mem_a' });
    expect(reopened.getState().items).toEqual(store.getState().items);
  });

  it('drops corrupted storage, and keeps no version for a list that lost an entry', () => {
    const { data, storage } = memoryStorage();
    data.set(STICKERS_STORAGE_KEY, '{not json');
    expect(createStickerLibrary({ api: fakeApi().api, storage }).getState()).toMatchObject({ items: [], version: null, status: 'idle', tab: 'emoji' });

    data.set(
      STICKERS_STORAGE_KEY,
      JSON.stringify({
        memberId: 'mem_a',
        items: [item(1), { ...item(2), type: 'svg' }, item(1), 'x', item(3)],
        max: 999,
        version: 7,
        recent: [stickerId(3), 'nope', stickerId(3), 42],
        tab: 'sideways',
      }),
    );
    const store = createStickerLibrary({ api: fakeApi().api, storage });
    expect(ids(store.getState().items)).toEqual([stickerId(1), stickerId(3)]);
    expect(store.getState()).toMatchObject({ version: null, recent: [stickerId(3)], tab: 'emoji', status: 'ready' });
  });

  it('ignores a list saved for another member', () => {
    const { data, storage } = memoryStorage();
    data.set(STICKERS_STORAGE_KEY, JSON.stringify({ memberId: 'mem_b', items: [item(1)], max: 999, version: 2, recent: [], tab: 'stickers' }));
    expect(createStickerLibrary({ api: fakeApi().api, storage }).getState()).toMatchObject({ items: [], version: null, memberId: null });
  });

  it('resets on sign-out and on a member switch, and saves the empty state', async () => {
    const { store, data } = await loaded();
    const stop = bindStickersToSession(store);
    store.getState().setTab('stickers');
    store.getState().pushRecent(stickerId(1));
    signIn('mem_b');
    expect(store.getState()).toMatchObject({ items: [], version: null, recent: [], tab: 'emoji', memberId: null, status: 'idle' });
    expect(JSON.parse(data.get(STICKERS_STORAGE_KEY) ?? '{}')).toMatchObject({ items: [], memberId: null });
    stop();
  });

  it('starts afresh when the saved collection belongs to someone else by the time it is used', async () => {
    const { store, fake } = await loaded();
    signIn('mem_b');
    const job = store.getState().ensureFresh();
    expect(store.getState()).toMatchObject({ items: [], memberId: 'mem_b', status: 'loading' });
    expect(fake.list.calls[1]?.args).toEqual([undefined]);
    fake.list.calls[1]?.resolve(listed([item(9)], 1));
    await job;
    expect(ids(store.getState().items)).toEqual([stickerId(9)]);
  });

  it('sends the version held, keeps the items when unchanged, and waits five minutes between lists', async () => {
    const { store, fake, advance } = await loaded();
    await store.getState().ensureFresh();
    expect(fake.list.fn).toHaveBeenCalledTimes(1);
    advance(STICKER_LIST_FRESH_MS + 1);
    const job = store.getState().ensureFresh();
    expect(store.getState().ensureFresh()).toBe(job);
    expect(fake.list.calls[1]?.args).toEqual([5]);
    const before = store.getState().items;
    fake.list.calls[1]?.resolve({ unchanged: true, max: 999, version: 5, mediaToken: 'media-2' });
    await job;
    expect(store.getState().items).toBe(before);
    expect(useSessionStore.getState().mediaToken).toBe('media-2');
  });

  it('keeps a saved list on a failed fetch, and says error only without one', async () => {
    const { store, fake, advance } = await loaded();
    advance(STICKER_LIST_FRESH_MS + 1);
    const job = store.getState().ensureFresh();
    fake.list.calls[1]?.reject(new TypeError('offline'));
    await job;
    expect(store.getState()).toMatchObject({ status: 'ready', version: 5 });
    expect(store.getState().items).toHaveLength(3);

    const empty = fakeApi();
    const fresh = createStickerLibrary({ api: empty.api, storage: memoryStorage().storage });
    const first = fresh.getState().ensureFresh();
    expect(fresh.getState().status).toBe('loading');
    empty.list.calls[0]?.reject(new TypeError('offline'));
    await first;
    expect(fresh.getState().status).toBe('error');
  });

  it('does nothing without a session', async () => {
    useSessionStore.setState({ token: null, member: null });
    const fake = fakeApi();
    const store = createStickerLibrary({ api: fake.api, storage: memoryStorage().storage });
    await store.getState().ensureFresh();
    expect(fake.list.fn).not.toHaveBeenCalled();
  });
});

describe('sticker library: moves and removals', () => {
  it('moves at once and puts the order back when the server refuses', async () => {
    const { store, fake } = await loaded();
    const job = store.getState().moveToFront([stickerId(3)]);
    expect(ids(store.getState().items)).toEqual([stickerId(3), stickerId(1), stickerId(2)]);
    expect(fake.front.calls[0]?.args).toEqual([[stickerId(3)]]);
    fake.front.calls[0]?.reject(new TypeError('offline'));
    expect(await job).toBe(false);
    expect(ids(store.getState().items)).toEqual([stickerId(1), stickerId(2), stickerId(3)]);
    expect(toast).toHaveBeenCalledWith('网络连接失败，请检查网络后重试');
  });

  it('keeps a move the server took, with its version', async () => {
    const { store, fake, data } = await loaded();
    const saved = () => JSON.parse(data.get(STICKERS_STORAGE_KEY) ?? '{}') as { version: number | null; items: StickerItem[] };
    const job = store.getState().moveToFront([stickerId(2), stickerId(3), stickerId(2), 'unknown']);
    expect(fake.front.calls[0]?.args).toEqual([[stickerId(2), stickerId(3)]]);
    // The order saved while the server has not answered carries no version.
    // 服务端答复之前保存的顺序不带版本号。
    expect(saved().version).toBeNull();
    expect(ids(saved().items)).toEqual([stickerId(2), stickerId(3), stickerId(1)]);
    fake.front.calls[0]?.resolve({ moved: 2, version: 6 });
    expect(await job).toBe(true);
    expect(ids(store.getState().items)).toEqual([stickerId(2), stickerId(3), stickerId(1)]);
    expect(store.getState().version).toBe(6);
    expect(saved().version).toBe(6);
  });

  it('sends nothing when the stickers already are the first ones in that order', async () => {
    const { store, fake } = await loaded();
    expect(await store.getState().moveToFront([stickerId(1), stickerId(2)])).toBe(true);
    expect(await store.getState().moveToFront([stickerId(1)])).toBe(true);
    expect(await store.getState().moveToFront([])).toBe(true);
    expect(fake.front.fn).not.toHaveBeenCalled();
  });

  it('stages a removal at once, undoes it in place, and commits it', async () => {
    const { store, fake, data } = await loaded();
    const first = store.getState().stageRemoval([stickerId(2)]);
    expect(ids(store.getState().items)).toEqual([stickerId(1), stickerId(3)]);
    // While a removal is not settled, the saved list carries no version.
    // 删除尚未完成时，保存的列表不带版本号。
    expect(JSON.parse(data.get(STICKERS_STORAGE_KEY) ?? '{}').version).toBeNull();
    store.getState().undoRemoval(first);
    expect(ids(store.getState().items)).toEqual([stickerId(1), stickerId(2), stickerId(3)]);
    expect(fake.remove.fn).not.toHaveBeenCalled();

    const second = store.getState().stageRemoval([stickerId(1), stickerId(3)]);
    expect(ids(store.getState().items)).toEqual([stickerId(2)]);
    const commit = store.getState().commitRemoval(second);
    expect(store.getState().commitRemoval(second)).toBe(commit);
    store.getState().undoRemoval(second);
    expect(ids(store.getState().items)).toEqual([stickerId(2)]);
    expect(fake.remove.calls[0]?.args).toEqual([[stickerId(1), stickerId(3)], { keepalive: false }]);
    fake.remove.calls[0]?.resolve({ removed: 2, total: 1, version: 6 });
    expect(await commit).toBe(true);
    expect(store.getState().version).toBe(6);
    expect(JSON.parse(data.get(STICKERS_STORAGE_KEY) ?? '{}').version).toBe(6);
    expect(await store.getState().commitRemoval(second)).toBe(true);
    expect(fake.remove.fn).toHaveBeenCalledTimes(1);
  });

  it('brings the stickers back where they were when the commit fails', async () => {
    const { store, fake } = await loaded();
    const removal = store.getState().stageRemoval([stickerId(1), stickerId(3)]);
    const commit = store.getState().commitRemoval(removal);
    fake.remove.calls[0]?.reject(new TypeError('offline'));
    expect(await commit).toBe(false);
    expect(ids(store.getState().items)).toEqual([stickerId(1), stickerId(2), stickerId(3)]);
    expect(toast).toHaveBeenCalledWith('网络连接失败，请检查网络后重试');
  });

  it('commits everything staged with keepalive and closes the undo snackbar', async () => {
    const { store, fake } = await loaded();
    store.getState().stageRemoval([stickerId(1)]);
    store.getState().stageRemoval([stickerId(2)]);
    store.getState().commitAllRemovals({ keepalive: true });
    expect(fake.remove.calls.map((call) => call.args)).toEqual([
      [[stickerId(1)], { keepalive: true }],
      [[stickerId(2)], { keepalive: true }],
    ]);
    expect(dismissSnackbar).toHaveBeenCalledTimes(1);
    store.getState().commitAllRemovals({ keepalive: true });
    expect(fake.remove.fn).toHaveBeenCalledTimes(2);
    expect(dismissSnackbar).toHaveBeenCalledTimes(1);
  });

  it('commits when the page is hidden or goes away, while anything is staged', async () => {
    const page = new EventTarget();
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    vi.stubGlobal('window', page);
    vi.stubGlobal('document', doc);
    const { store, fake } = await loaded();
    store.getState().stageRemoval([stickerId(2)]);
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(fake.remove.fn).not.toHaveBeenCalled();
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(fake.remove.calls[0]?.args).toEqual([[stickerId(2)], { keepalive: true }]);
    fake.remove.calls[0]?.resolve({ removed: 1, total: 2, version: 6 });
    await flush();
    page.dispatchEvent(new Event('pagehide'));
    expect(fake.remove.fn).toHaveBeenCalledTimes(1);
  });

  it('puts removed stickers back next to the neighbour above them, leaving later changes alone', () => {
    const [a, b, c, d, e] = [1, 2, 3, 4, 5].map((n) => item(n)) as [StickerItem, StickerItem, StickerItem, StickerItem, StickerItem];
    const fresh = item(9);
    // b and e were removed; d moved to the front and a new sticker arrived meanwhile.
    // 删除了 b 和 e；期间 d 被移到最前，又新增了一个表情。
    expect(ids(restoreRemoved([fresh, d, a, c], [a, b, c, d, e], [b, e]))).toEqual(ids([fresh, d, e, a, b, c]));
    expect(ids(restoreRemoved([c, d], [a, b, c, d], [a, b]))).toEqual(ids([a, b, c, d]));
    expect(ids(restoreRemoved([fresh, c], [a, b, c], [a]))).toEqual(ids([fresh, a, c]));
    expect(ids(restoreRemoved([], [a, b], [a, b]))).toEqual(ids([a, b]));
  });
});

describe('sticker library: races', () => {
  it('drops a list that started before an add and answers after it', async () => {
    const { store, fake, advance } = await loaded();
    advance(STICKER_LIST_FRESH_MS + 1);
    const list = store.getState().ensureFresh();
    const add = store.getState().addSticker(item(7));
    fake.add.calls[0]?.resolve({ sticker: item(7), duplicate: false, total: 4, version: 6 });
    await add;
    fake.list.calls[1]?.resolve(listed([item(1), item(2), item(3)], 5));
    await list;
    expect(ids(store.getState().items)).toEqual([stickerId(7), stickerId(1), stickerId(2), stickerId(3)]);
    // The dropped list is asked for again at once; the server is at the version now held.
    // 被丢弃的列表会立即重新获取；服务端的版本就是现在持有的版本。
    expect(fake.list.calls[2]?.args).toEqual([6]);
  });

  it('drops a list that started before a move and answers after it', async () => {
    const { store, fake, advance } = await loaded();
    advance(STICKER_LIST_FRESH_MS + 1);
    const list = store.getState().ensureFresh();
    const move = store.getState().moveToFront([stickerId(3)]);
    fake.list.calls[1]?.resolve(listed([item(1), item(2), item(3)], 5));
    await list;
    expect(ids(store.getState().items)).toEqual([stickerId(3), stickerId(1), stickerId(2)]);
    fake.front.calls[0]?.resolve({ moved: 1, version: 6 });
    await move;
    expect(ids(store.getState().items)).toEqual([stickerId(3), stickerId(1), stickerId(2)]);
    expect(fake.list.calls[2]?.args).toEqual([6]);
  });

  it('drops a list that started before a staged removal, and keeps the removed ids out of a later list', async () => {
    const { store, fake, advance } = await loaded();
    advance(STICKER_LIST_FRESH_MS + 1);
    const list = store.getState().ensureFresh();
    store.getState().stageRemoval([stickerId(2)]);
    fake.list.calls[1]?.resolve(listed([item(1), item(2), item(3)], 5));
    await list;
    expect(ids(store.getState().items)).toEqual([stickerId(1), stickerId(3)]);
    // The list asked for again is kept, without the staged removal.
    // 重新获取的列表会被采用，但不包括暂存删除的表情。
    fake.list.calls[2]?.resolve(listed([item(4), item(1), item(2), item(3)], 6));
    await flush();
    expect(ids(store.getState().items)).toEqual([stickerId(4), stickerId(1), stickerId(3)]);
  });

  it('makes one request for two adds of the same sticker while the first is in flight', async () => {
    const { store, fake } = await loaded();
    const ref = item(8, { thumb: 'S'.repeat(22) });
    const first = store.getState().addSticker(ref);
    const second = store.getState().addSticker(ref);
    expect(second).toBe(first);
    expect(fake.add.calls).toHaveLength(1);
    expect(fake.add.calls[0]?.args).toEqual([ref.id, 'S'.repeat(22)]);
    fake.add.calls[0]?.resolve({ sticker: ref, duplicate: false, total: 4, version: 6 });
    expect(await first).toEqual({ kind: 'added', sticker: ref });
    await flush();
    const third = store.getState().addSticker(ref);
    expect(fake.add.calls).toHaveLength(2);
    fake.add.calls[1]?.resolve({ sticker: ref, duplicate: true, total: 4, version: 7 });
    expect(await third).toEqual({ kind: 'duplicate', sticker: ref });
    expect(ids(store.getState().items).filter((id) => id === ref.id)).toHaveLength(1);
  });

  it('moves a repeat add to the front, and names a limit or a failure', async () => {
    const { store, fake } = await loaded();
    const repeat = store.getState().addSticker(item(3));
    fake.add.calls[0]?.resolve({ sticker: item(3), duplicate: true, total: 3, version: 6 });
    expect((await repeat).kind).toBe('duplicate');
    expect(ids(store.getState().items)).toEqual([stickerId(3), stickerId(1), stickerId(2)]);

    const full = store.getState().addSticker(item(10));
    fake.add.calls[1]?.reject(new ApiClientError(409, 'sticker_full', '最多添加 999 个表情，请先删除一些'));
    expect(await full).toEqual({ kind: 'limit', message: '最多添加 999 个表情，请先删除一些' });
    const gone = store.getState().addSticker(item(11));
    fake.add.calls[2]?.reject(new ApiClientError(404, 'sticker_not_found', '这个表情已失效'));
    expect(await gone).toEqual({ kind: 'failed', message: '这个表情已失效' });
  });

  it('adopts only a version that follows the one held, and fetches again otherwise', async () => {
    const { store, fake } = await loaded();
    const add = store.getState().addSticker(item(7));
    fake.add.calls[0]?.resolve({ sticker: item(7), duplicate: false, total: 4, version: 8 });
    await add;
    // Another device changed the collection too (versions 6 and 7): keep 5 and fetch the full list.
    // 另一台设备也改动了表情列表（版本 6 和 7）：保留 5，并获取完整列表。
    expect(store.getState().version).toBe(5);
    expect(fake.list.calls[1]?.args).toEqual([5]);
    fake.list.calls[1]?.resolve(listed([item(7), item(6), item(1), item(2), item(3)], 8));
    await flush();
    expect(store.getState()).toMatchObject({ version: 8 });
    expect(ids(store.getState().items)).toContain(stickerId(6));
  });
});

describe('sticker library: recent', () => {
  it('keeps the most recent first, without repeats, up to the cap', async () => {
    const { store } = await loaded();
    for (let n = 1; n <= STICKER_RECENT_MAX + 3; n += 1) store.getState().pushRecent(stickerId(n));
    store.getState().pushRecent(stickerId(5));
    const recent = store.getState().recent;
    expect(recent).toHaveLength(STICKER_RECENT_MAX);
    expect(recent[0]).toBe(stickerId(5));
    expect(recent[1]).toBe(stickerId(STICKER_RECENT_MAX + 3));
    expect(new Set(recent).size).toBe(recent.length);
    store.getState().pushRecent('not-a-sticker');
    expect(store.getState().recent[0]).toBe(stickerId(5));
  });

  it('shows only recent stickers still in the collection, as the same array while nothing changes', async () => {
    const { store } = await loaded();
    store.getState().pushRecent(stickerId(9));
    store.getState().pushRecent(stickerId(3));
    store.getState().pushRecent(stickerId(1));
    const first = recentStickers(store.getState());
    expect(ids(first)).toEqual([stickerId(1), stickerId(3)]);
    expect(recentStickers(store.getState())).toBe(first);
    store.getState().stageRemoval([stickerId(1)]);
    expect(ids(recentStickers(store.getState()))).toEqual([stickerId(3)]);
  });

  it('remembers the panel tab', async () => {
    const { store, storage } = await loaded();
    store.getState().setTab('stickers');
    expect(createStickerLibrary({ api: fakeApi().api, storage }).getState().tab).toBe('stickers');
  });
});

describe('sticker library: uploads', () => {
  function respond(n: number, version: number, duplicate = false) {
    return { status: duplicate ? 200 : 201, body: { sticker: item(n), duplicate, total: 3 + n, version } };
  }

  it('shows a tile per file at once, uploads last picked first, and ends in the order picked', async () => {
    const order: string[] = [];
    const prepare = vi.fn(async (file: Blob) => prepared(file.size));
    const { store } = await loaded({ prepare });
    let version = 5;
    upload.mockImplementation(async (input) => {
      const n = (input as PreparedSticker).file.size;
      order.push(`upload ${n}`);
      version += 1;
      return respond(100 + n, version);
    });
    const files = [new Blob([new Uint8Array(1)]), new Blob([new Uint8Array(2)]), new Blob([new Uint8Array(3)])];
    const job = store.getState().addFiles(files, { onPrepared: (problems) => order.push(`prepared ${problems.length}`) });
    expect(store.getState().uploads.map((tile) => tile.status)).toEqual(['preparing', 'preparing', 'preparing']);
    const outcomes = await job;
    expect(order).toEqual(['prepared 0', 'upload 3', 'upload 2', 'upload 1']);
    expect(outcomes.map((outcome) => outcome.kind)).toEqual(['added', 'added', 'added']);
    expect(outcomes.map((outcome) => (outcome.kind === 'added' ? outcome.sticker.id : null))).toEqual([stickerId(101), stickerId(102), stickerId(103)]);
    expect(ids(store.getState().items).slice(0, 3)).toEqual([stickerId(101), stickerId(102), stickerId(103)]);
    expect(store.getState().uploads).toEqual([]);
    expect(store.getState().version).toBe(8);
  });

  it('reports every preparation problem once, before any upload', async () => {
    const events: string[] = [];
    const prepare = vi.fn(async (file: Blob) => {
      if (file.size === 2) throw new StickerPrepError('size');
      if (file.size === 3) throw new StickerPrepError('type');
      return prepared(file.size);
    });
    const { store } = await loaded({ prepare });
    upload.mockImplementation(async () => {
      events.push('upload');
      return respond(50, 6);
    });
    const onPrepared = vi.fn((problems: readonly string[]) => events.push(`prepared ${problems.join(' | ')}`));
    const outcomes = await store.getState().addFiles([new Blob([new Uint8Array(1)]), new Blob([new Uint8Array(2)]), new Blob([new Uint8Array(3)])], { onPrepared });
    expect(onPrepared).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['prepared 表情不能超过 8MB | 只支持 JPEG、PNG、WebP、GIF', 'upload']);
    expect(outcomes).toEqual([
      { kind: 'added', sticker: item(50) },
      { kind: 'failed', message: '表情不能超过 8MB' },
      { kind: 'failed', message: '只支持 JPEG、PNG、WebP、GIF' },
    ]);
  });

  it('drops every queued tile at a limit and stops', async () => {
    const prepare = vi.fn(async (file: Blob) => prepared(file.size));
    const { store } = await loaded({ prepare });
    upload.mockRejectedValue(new ApiClientError(429, 'sticker_daily_limit', '今天上传的表情太多了，请明天再试'));
    const outcomes = await store.getState().addFiles([new Blob([new Uint8Array(1)]), new Blob([new Uint8Array(2)]), new Blob([new Uint8Array(3)])]);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(outcomes).toEqual(new Array(3).fill({ kind: 'limit', message: '今天上传的表情太多了，请明天再试' }));
    expect(store.getState().uploads).toEqual([]);
  });

  it('refuses only a blocked file, and uploads the rest of the pick and what is queued behind it', async () => {
    const prepare = vi.fn(async (file: Blob) => prepared(file.size));
    const { store } = await loaded({ prepare });
    const calls: Call<Awaited<ReturnType<typeof uploadSticker>>>[] = [];
    upload.mockImplementation((input) => new Promise((resolve, reject) => calls.push({ args: [(input as PreparedSticker).file.size], resolve, reject })));
    const pick = store.getState().addFiles([new Blob([new Uint8Array(1)]), new Blob([new Uint8Array(2)]), new Blob([new Uint8Array(3)])]);
    await flush();
    // A photo added from a chat message waits behind the pick.
    // 从聊天消息添加的图片排在这次选择之后。
    const photo = store.getState().addFiles([new Blob([new Uint8Array(4)])]);
    await flush();
    expect(calls.map((call) => call.args[0])).toEqual([3]);
    calls[0]?.reject(new ApiClientError(409, 'sticker_blocked', '这个表情已被停用'));
    await flush();
    expect(store.getState().uploads.map((tile) => tile.status)).toEqual(['queued', 'queued', 'uploading']);
    calls[1]?.resolve(respond(102, 6));
    await flush();
    calls[2]?.resolve(respond(101, 7));
    await flush();
    calls[3]?.resolve(respond(104, 8));
    expect(await pick).toEqual([
      { kind: 'added', sticker: item(101) },
      { kind: 'added', sticker: item(102) },
      { kind: 'limit', message: '这个表情已被停用' },
    ]);
    expect(await photo).toEqual([{ kind: 'added', sticker: item(104) }]);
    expect(calls.map((call) => call.args[0])).toEqual([3, 2, 1, 4]);
    expect(store.getState().uploads).toEqual([]);
    expect(ids(store.getState().items).slice(0, 3)).toEqual([stickerId(104), stickerId(101), stickerId(102)]);
  });

  it('takes a retried tile away and says why when the file turns out blocked', async () => {
    const prepare = vi.fn(async (file: Blob) => prepared(file.size));
    const { store } = await loaded({ prepare });
    upload.mockRejectedValueOnce(new TypeError('offline'));
    await store.getState().addFiles([new Blob([new Uint8Array(4)])]);
    const [tile] = store.getState().uploads;
    upload.mockRejectedValueOnce(new ApiClientError(409, 'sticker_blocked', '这个表情已被停用'));
    store.getState().retryUpload(tile?.localId ?? '');
    await flush();
    expect(store.getState().uploads).toEqual([]);
    expect(toast).toHaveBeenCalledWith('这个表情已被停用');
  });

  it('gives up on a stalled upload as a network failure, so its tile offers a retry and the queue moves on', async () => {
    const actual = await vi.importActual<typeof import('./upload')>('./upload');
    const prepare = vi.fn(async (file: Blob) => prepared(file.size));
    const { store, fake } = await loaded({ prepare, upload: actual.uploadSticker });
    SilentXhr.all = [];
    vi.stubGlobal('XMLHttpRequest', SilentXhr);
    vi.useFakeTimers();
    try {
      const job = store.getState().addFiles([new Blob([new Uint8Array(1)]), new Blob([new Uint8Array(2)])]);
      await vi.advanceTimersByTimeAsync(0);
      expect(SilentXhr.all).toHaveLength(1);
      const stalled = store.getState().uploads.find((tile) => tile.status === 'uploading');
      expect(stalled).toBeDefined();
      await vi.advanceTimersByTimeAsync(actual.STICKER_UPLOAD_STALL_MS - 1);
      expect(SilentXhr.all).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      // The stalled tile fails with the network text; the next file uploads at once.
      // 卡住的图块以网络失败的提示失败；下一个文件立即开始上传。
      expect(store.getState().uploads.find((tile) => tile.localId === stalled?.localId)).toMatchObject({ status: 'failed', failure: '网络连接失败，请检查网络后重试' });
      expect(SilentXhr.all).toHaveLength(2);
      // The server may have stored the stalled file, so the list is asked for again.
      // 服务端可能已经保存了卡住的文件，因此重新请求列表。
      expect(fake.list.calls[1]?.args).toEqual([5]);
      SilentXhr.all[1]?.respond(201, respond(101, 6).body);
      expect(await job).toEqual([
        { kind: 'added', sticker: item(101) },
        { kind: 'failed', message: '网络连接失败，请检查网络后重试' },
      ]);
      store.getState().retryUpload(stalled?.localId ?? '');
      await vi.advanceTimersByTimeAsync(0);
      SilentXhr.all[2]?.respond(201, respond(102, 7).body);
      await vi.advanceTimersByTimeAsync(0);
      expect(store.getState().uploads).toEqual([]);
      expect(ids(store.getState().items).slice(0, 2)).toEqual([stickerId(102), stickerId(101)]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a failed tile with its reason, and a retry finishes it', async () => {
    const prepare = vi.fn(async (file: Blob) => prepared(file.size));
    const { store } = await loaded({ prepare });
    upload.mockRejectedValueOnce(new TypeError('offline'));
    const [outcome] = await store.getState().addFiles([new Blob([new Uint8Array(4)])]);
    expect(outcome).toEqual({ kind: 'failed', message: '网络连接失败，请检查网络后重试' });
    const [tile] = store.getState().uploads;
    expect(tile).toMatchObject({ status: 'failed', failure: '网络连接失败，请检查网络后重试', previewUrl: 'blob:preview-4' });
    upload.mockResolvedValueOnce(respond(40, 6));
    store.getState().retryUpload(tile?.localId ?? '');
    await flush();
    expect(store.getState().uploads).toEqual([]);
    expect(store.getState().items[0]?.id).toBe(stickerId(40));
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it('fetches the list again when an upload gets no answer, since the server may have stored it, but not after a refusal', async () => {
    const prepare = vi.fn(async (file: Blob) => prepared(file.size));
    const { store, fake } = await loaded({ prepare });
    upload.mockRejectedValueOnce(new ApiClientError(400, 'checksum_mismatch', '上传的文件不完整，请重试'));
    await store.getState().addFiles([new Blob([new Uint8Array(3)])]);
    expect(fake.list.fn).toHaveBeenCalledTimes(1);
    upload.mockRejectedValueOnce(new TypeError('offline'));
    const [outcome] = await store.getState().addFiles([new Blob([new Uint8Array(4)])]);
    expect(outcome).toEqual({ kind: 'failed', message: '网络连接失败，请检查网络后重试' });
    expect(fake.list.calls[1]?.args).toEqual([5]);
    fake.list.calls[1]?.resolve(listed([item(70), item(1), item(2), item(3)], 6));
    await flush();
    // The list shows what the server holds; the failed tile stays, and its retry comes back as a repeat.
    // 列表显示服务端已有的内容；失败的图块保留，重试时作为重复添加返回。
    expect(ids(store.getState().items)).toEqual([stickerId(70), stickerId(1), stickerId(2), stickerId(3)]);
    const failed = store.getState().uploads.find((tile) => tile.previewUrl === 'blob:preview-4');
    expect(failed).toMatchObject({ status: 'failed' });
    upload.mockResolvedValueOnce({ status: 200, body: { sticker: item(70), duplicate: true, total: 4, version: 6 } });
    store.getState().retryUpload(failed?.localId ?? '');
    await flush();
    expect(store.getState().uploads.map((tile) => tile.previewUrl)).toEqual(['blob:preview-3']);
    expect(ids(store.getState().items)).toEqual([stickerId(70), stickerId(1), stickerId(2), stickerId(3)]);
  });

  it('lets the member remove a queued or failed tile', async () => {
    const prepare = vi.fn(async (file: Blob) => prepared(file.size));
    const { store } = await loaded({ prepare });
    let release: (() => void) | null = null;
    upload.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(respond(60, 6));
        }),
    );
    const job = store.getState().addFiles([new Blob([new Uint8Array(1)]), new Blob([new Uint8Array(2)])]);
    await flush();
    // The second file uploads first; the first waits in the queue.
    // 第二个文件先上传；第一个在队列中等待。
    const queued = store.getState().uploads.find((tile) => tile.status === 'queued');
    expect(queued).toBeDefined();
    store.getState().dropUpload(queued?.localId ?? '');
    expect(store.getState().uploads).toHaveLength(1);
    (release as (() => void) | null)?.();
    const outcomes = await job;
    expect(outcomes[0]).toEqual({ kind: 'failed', message: '' });
    expect(outcomes[1]?.kind).toBe('added');
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('moves the existing sticker to the front for a duplicate upload', async () => {
    const prepare = vi.fn(async (file: Blob) => prepared(file.size));
    const { store } = await loaded({ prepare });
    upload.mockResolvedValueOnce({ status: 200, body: { sticker: item(3), duplicate: true, total: 3, version: 6 } });
    const [outcome] = await store.getState().addFiles([new Blob([new Uint8Array(1)])]);
    expect(outcome).toEqual({ kind: 'duplicate', sticker: item(3) });
    expect(ids(store.getState().items)).toEqual([stickerId(3), stickerId(1), stickerId(2)]);
    expect(store.getState().uploads).toEqual([]);
  });
});

describe('sticker library: app update hold', () => {
  const files = (...sizes: number[]) => sizes.map((size) => new Blob([new Uint8Array(size)]));

  function respond(n: number, version: number) {
    return { status: 201, body: { sticker: item(n), duplicate: false, total: 3 + n, version } };
  }

  it('holds back an app update from a pick until its last file is in, with one hold for the whole batch', async () => {
    const prepare = vi.fn(async (file: Blob) => prepared(file.size));
    const { store, holds, holdUpdate } = await loaded({ prepare });
    const calls: Call<Awaited<ReturnType<typeof uploadSticker>>>[] = [];
    upload.mockImplementation(() => new Promise((resolve, reject) => calls.push({ args: [], resolve, reject })));
    expect(holds.held).toBe(false);
    const job = store.getState().addFiles(files(1, 2));
    // Held from the moment the tiles show, while the files are still being prepared.
    // 从图块出现起就占用，那时文件还在准备中。
    expect(holds.held).toBe(true);
    await flush();
    expect(store.getState().uploads.map((tile) => tile.status)).toEqual(['queued', 'uploading']);
    calls[0]?.resolve(respond(102, 6));
    await flush();
    expect(holds.held).toBe(true);
    calls[1]?.resolve(respond(101, 7));
    await job;
    expect(store.getState().uploads).toEqual([]);
    expect(holds.held).toBe(false);
    expect(holdUpdate).toHaveBeenCalledTimes(1);
  });

  it('lets go at a cap that drops the queue and while only failed tiles wait, and holds again on 重试', async () => {
    const prepare = vi.fn(async (file: Blob) => prepared(file.size));
    const { store, holds, holdUpdate } = await loaded({ prepare });
    upload.mockRejectedValueOnce(new ApiClientError(429, 'sticker_daily_limit', '今天上传的表情太多了，请明天再试'));
    await store.getState().addFiles(files(1, 2, 3));
    expect(store.getState().uploads).toEqual([]);
    expect(holds.held).toBe(false);

    upload.mockRejectedValueOnce(new TypeError('offline'));
    await store.getState().addFiles(files(4));
    const [tile] = store.getState().uploads;
    expect(tile?.status).toBe('failed');
    // A failed tile waits for the member, so it does not keep the update back.
    // 失败的图块等成员处理，因此不推迟更新。
    expect(holds.held).toBe(false);
    upload.mockResolvedValueOnce(respond(40, 6));
    store.getState().retryUpload(tile?.localId ?? '');
    expect(holds.held).toBe(true);
    await flush();
    expect(store.getState().uploads).toEqual([]);
    expect(holds.held).toBe(false);
    expect(holdUpdate).toHaveBeenCalledTimes(3);
  });

  it('lets go when the member removes the tiles, and on a sign-out mid-pick', async () => {
    const prepare = vi.fn(async (file: Blob) => prepared(file.size));
    const { store, holds } = await loaded({ prepare });
    upload.mockImplementation(
      (_input, options = {}) =>
        new Promise((_resolve, reject) => {
          options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    );
    const job = store.getState().addFiles(files(1, 2));
    await flush();
    expect(holds.held).toBe(true);
    for (const tile of store.getState().uploads) store.getState().dropUpload(tile.localId);
    expect(store.getState().uploads).toEqual([]);
    expect(holds.held).toBe(false);
    expect(await job).toEqual([
      { kind: 'failed', message: '' },
      { kind: 'failed', message: '' },
    ]);

    const stop = bindStickersToSession(store);
    void store.getState().addFiles(files(3));
    expect(holds.held).toBe(true);
    useSessionStore.setState({ token: null, member: null, mediaToken: null });
    expect(holds.held).toBe(false);
    stop();
  });

  it('holds while a move, an add or a removal is on its way, and while a removal is staged', async () => {
    const { store, fake, holds, holdUpdate } = await loaded();
    const move = store.getState().moveToFront([stickerId(3)]);
    expect(holds.held).toBe(true);
    fake.front.calls[0]?.resolve({ moved: 1, version: 6 });
    await move;
    expect(holds.held).toBe(false);
    const refused = store.getState().moveToFront([stickerId(2)]);
    expect(holds.held).toBe(true);
    fake.front.calls[1]?.reject(new TypeError('offline'));
    await refused;
    expect(holds.held).toBe(false);

    const add = store.getState().addSticker(item(9));
    expect(holds.held).toBe(true);
    fake.add.calls[0]?.resolve({ sticker: item(9), duplicate: false, total: 4, version: 7 });
    await add;
    expect(holds.held).toBe(false);

    // A staged removal holds until it is undone, or until the server has answered its commit either way.
    // 暂存的删除一直占用，直到撤销，或者服务端对它的提交作出答复（无论成功与否）。
    const undone = store.getState().stageRemoval([stickerId(1)]);
    expect(holds.held).toBe(true);
    store.getState().undoRemoval(undone);
    expect(holds.held).toBe(false);
    const commit = store.getState().commitRemoval(store.getState().stageRemoval([stickerId(1)]));
    expect(holds.held).toBe(true);
    fake.remove.calls[0]?.resolve({ removed: 1, total: 3, version: 8 });
    await commit;
    expect(holds.held).toBe(false);
    const failed = store.getState().commitRemoval(store.getState().stageRemoval([stickerId(2)]));
    expect(holds.held).toBe(true);
    fake.remove.calls[1]?.reject(new TypeError('offline'));
    await failed;
    expect(holds.held).toBe(false);
    const empty = store.getState().stageRemoval(['unknown']);
    expect(holds.held).toBe(true);
    await store.getState().commitRemoval(empty);
    expect(holds.held).toBe(false);
    expect(holdUpdate).toHaveBeenCalledTimes(7);
  });

  it('lets go on a reset, whatever was on its way', async () => {
    const prepare = vi.fn(async (file: Blob) => prepared(file.size));
    const { store, fake, holds } = await loaded({ prepare });
    upload.mockImplementation(() => new Promise(() => undefined));
    void store.getState().moveToFront([stickerId(3)]);
    store.getState().stageRemoval([stickerId(1)]);
    void store.getState().addSticker(item(9));
    void store.getState().addFiles(files(1));
    await flush();
    expect(holds.held).toBe(true);
    store.getState().reset();
    expect(holds.held).toBe(false);
    // Work from before the reset that settles after it takes no hold; new work takes one again.
    // 重置之前的工作在重置之后才完成时不再占用；新的工作会重新占用。
    fake.front.calls[0]?.resolve({ moved: 1, version: 6 });
    fake.add.calls[0]?.resolve({ sticker: item(9), duplicate: false, total: 4, version: 7 });
    await flush();
    expect(holds.held).toBe(false);
    void store.getState().addFiles(files(2));
    expect(holds.held).toBe(true);
    store.getState().reset();
    expect(holds.held).toBe(false);
  });
});
