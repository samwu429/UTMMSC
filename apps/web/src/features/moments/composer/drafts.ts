import { LOCATION_MAX, MOMENT_AUDIENCES, MOMENT_IMAGE_LIMIT, MOMENT_TEXT_MAX, type MomentAudience } from '@utmmsc/shared';
import { useSessionStore } from '../../../shared/session/store';
import { safeLocalStorage, type SyncStateStorage } from '../../chat/state/safeStorage';
import type { ComposeDraft } from '../model';
import type { ComposeBatch } from './composeQueue';

/**
 * What 保留 keeps of an unfinished post, and the places the composer suggests. Text, audience and location go
 * to localStorage under the member's id; the picked media stay in memory for the session only, so after a
 * reload a draft with media says 照片需要重新选择. Recent places are the last five published from this device.
 * Signing out clears all of it. Storage that throws only makes drafts last until the page closes.
 * 「保留」为未完成的动态保存的内容，以及编辑器建议的地点。正文、可见范围和位置按成员 id 存入 localStorage；选中的媒体只保存在
 * 本次会话的内存中，因此重新加载后带媒体的草稿会提示「照片需要重新选择」。最近地点是本设备最近发表时用过的五个。
 * 退出登录时全部清除。存储抛错时，草稿只会保留到页面关闭为止。
 */

export const COMPOSE_DRAFT_PREFIX = 'utmmsc.moments.draft.v1.';
export const RECENT_PLACES_PREFIX = 'utmmsc.moments.places.v1.';
export const RECENT_PLACES_MAX = 5;
/** Stored text is capped well above MOMENT_TEXT_MAX, so an over-limit draft comes back as typed but storage stays bounded. */
/** 保存的正文上限远高于 MOMENT_TEXT_MAX，超长的草稿也能原样恢复，同时存储大小仍有上限。 */
const DRAFT_TEXT_STORE_MAX = MOMENT_TEXT_MAX * 4;

/** 取消 asks 将此次编辑保留？ only when there is text or media; a place or an audience alone is not worth keeping. */
/** 只有正文或媒体时，「取消」才会询问「将此次编辑保留？」；只有地点或可见范围不值得保留。 */
export function draftHasContent(draft: { text: string; mediaCount: number }): boolean {
  return draft.text.trim().length > 0 || draft.mediaCount > 0;
}

/** Cuts `text` to `max` UTF-16 units without leaving half of a surrogate pair at the cut. */
/** 把 `text` 截到 `max` 个 UTF-16 单元，且不会在截断处留下半个代理对。 */
function capUnits(text: string, max: number): string {
  if (text.length <= max) return text;
  const last = text.charCodeAt(max - 1);
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? max - 1 : max);
}

/**
 * A place as it is stored and sent: controls dropped, runs of white space made one space, trimmed, and at most
 * LOCATION_MAX UTF-16 units, so the server accepts it however it counts.
 * 地点保存和发送时的形式：去掉控制字符，连续空白合并为一个空格，去掉首尾空白，最多 LOCATION_MAX 个 UTF-16 单元，无论服务器怎样计数都能接受。
 */
export function normalizePlace(raw: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.replace(/[\u0000-\u001F\u007F-\u009F\u200B\u2028\u2029\uFEFF]/g, ' ').replace(/\s+/g, ' ').trim();
  return capUnits(cleaned, LOCATION_MAX).trim();
}

/** `place` first, then the earlier ones without it (compared ignoring case), at most five. */
/** `place` 排在最前，后面是去掉它之后的其余地点（比较时忽略大小写），最多五个。 */
export function withRecentPlace(places: readonly string[], place: string): string[] {
  const next = normalizePlace(place);
  if (!next) return places.slice(0, RECENT_PLACES_MAX);
  const same = next.toLocaleLowerCase();
  return [next, ...places.filter((item) => item.toLocaleLowerCase() !== same)].slice(0, RECENT_PLACES_MAX);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJson(storage: SyncStateStorage, key: string): unknown {
  const raw = storage.getItem(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/** Rebuilds a stored draft field by field, so a broken or hand-edited entry is dropped instead of crashing. */
/** 逐字段重建保存的草稿，损坏或被手动改过的条目会被丢弃，而不会导致崩溃。 */
function cleanDraft(value: unknown): ComposeDraft | null {
  if (!isRecord(value) || typeof value.text !== 'string') return null;
  const audience: MomentAudience = (MOMENT_AUDIENCES as readonly unknown[]).includes(value.audience) ? (value.audience as MomentAudience) : 'friends';
  const location = typeof value.location === 'string' ? normalizePlace(value.location) || null : null;
  const count = typeof value.mediaCount === 'number' && Number.isInteger(value.mediaCount) ? value.mediaCount : 0;
  const draft: ComposeDraft = {
    text: capUnits(value.text, DRAFT_TEXT_STORE_MAX),
    audience,
    location,
    mediaCount: Math.min(MOMENT_IMAGE_LIMIT, Math.max(0, count)),
    savedAt: typeof value.savedAt === 'string' ? value.savedAt : new Date(0).toISOString(),
  };
  return draftHasContent(draft) ? draft : null;
}

export interface ComposeDrafts {
  load(memberId: string): ComposeDraft | null;
  /** A draft without text or media removes the saved one instead. */
  /** 没有正文和媒体的草稿会改为删除已保存的草稿。 */
  save(memberId: string, draft: Omit<ComposeDraft, 'savedAt'>): void;
  clear(memberId: string): void;
  /** Newest first, at most five. */
  /** 最新的在前，最多五个。 */
  recentPlaces(memberId: string): string[];
  /** Called on 发表 with the place the post carries. */
  /** 「发表」时以动态所带的地点调用。 */
  rememberPlace(memberId: string, place: string): void;
  /** Sign-out: the draft and the recent places. */
  /** 退出登录：清除草稿和最近地点。 */
  forget(memberId: string): void;
}

/** Tests pass their own storage and clock. */
/** 测试可以传入自己的存储和时钟。 */
export function createComposeDrafts(storage: SyncStateStorage = safeLocalStorage, now: () => Date = () => new Date()): ComposeDrafts {
  const draftKey = (memberId: string) => `${COMPOSE_DRAFT_PREFIX}${memberId}`;
  const placesKey = (memberId: string) => `${RECENT_PLACES_PREFIX}${memberId}`;

  function recentPlaces(memberId: string): string[] {
    const value = readJson(storage, placesKey(memberId));
    if (!Array.isArray(value)) return [];
    let places: string[] = [];
    for (const item of value.slice().reverse()) {
      if (typeof item === 'string') places = withRecentPlace(places, item);
    }
    return places;
  }

  return {
    load(memberId) {
      const key = draftKey(memberId);
      const draft = cleanDraft(readJson(storage, key));
      if (!draft && storage.getItem(key) !== null) storage.removeItem(key);
      return draft;
    },
    save(memberId, draft) {
      const entry: ComposeDraft = {
        text: capUnits(draft.text, DRAFT_TEXT_STORE_MAX),
        audience: draft.audience,
        location: draft.location ? normalizePlace(draft.location) || null : null,
        mediaCount: Math.min(MOMENT_IMAGE_LIMIT, Math.max(0, Math.floor(draft.mediaCount))),
        savedAt: now().toISOString(),
      };
      if (!draftHasContent(entry)) {
        storage.removeItem(draftKey(memberId));
        return;
      }
      storage.setItem(draftKey(memberId), JSON.stringify(entry));
    },
    clear(memberId) {
      storage.removeItem(draftKey(memberId));
    },
    recentPlaces,
    rememberPlace(memberId, place) {
      const current = recentPlaces(memberId);
      const next = withRecentPlace(current, place);
      if (next.length === current.length && next.every((item, index) => item === current[index])) return;
      storage.setItem(placesKey(memberId), JSON.stringify(next));
    },
    forget(memberId) {
      storage.removeItem(draftKey(memberId));
      storage.removeItem(placesKey(memberId));
    },
  };
}

export const composeDrafts = createComposeDrafts();

/* Media kept by 保留, in memory for this session */
/* 「保留」留下的媒体，只保存在本次会话的内存中 */

let kept: { memberId: string; batch: ComposeBatch } | null = null;

/** The media the member kept, without taking them; safe to call while rendering. */
/** 成员保留的媒体，只查看不取走；可以在渲染时调用。 */
export function peekKeptMedia(memberId: string): ComposeBatch | null {
  return kept && kept.memberId === memberId ? kept.batch : null;
}

/** 保留: the batch waits here, still uploading, until the composer opens again. A batch kept earlier is released. */
/** 「保留」：批次留在这里并继续上传，直到编辑器再次打开。之前保留的批次会被释放。 */
export function keepMedia(memberId: string, batch: ComposeBatch): void {
  if (kept && kept.batch !== batch) kept.batch.release();
  kept = { memberId, batch };
}

/** The composer took this batch back. */
/** 编辑器取回了这个批次。 */
export function claimKeptMedia(batch: ComposeBatch): void {
  if (kept?.batch === batch) kept = null;
}

/** 不保留, sign-out, or new media of the other kind: the kept batch is released. */
/** 「不保留」、退出登录，或选了另一种类型的新媒体：释放保留的批次。 */
export function dropKeptMedia(): void {
  const current = kept;
  kept = null;
  current?.batch.release();
}

/** Clears the signed-out member's draft, places and kept media. Returns the unsubscribe function. */
/** 清除已退出成员的草稿、地点和保留的媒体。返回取消订阅的函数。 */
export function bindComposeDraftsToSession(drafts: ComposeDrafts = composeDrafts): () => void {
  return useSessionStore.subscribe((state, prev) => {
    const previous = prev.member?.id ?? null;
    const signedOut = prev.token !== null && state.token === null;
    const switched = previous !== null && state.member !== null && state.member.id !== previous;
    if (!signedOut && !switched) return;
    if (kept && kept.memberId !== state.member?.id) dropKeptMedia();
    if (previous) drafts.forget(previous);
  });
}

bindComposeDraftsToSession();
