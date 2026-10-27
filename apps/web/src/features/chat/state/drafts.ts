import { MESSAGE_TEXT_MAX, QUOTE_EXCERPT_MAX, redactQuotePreview, type QuotePreview, type QuoteState } from '@utmmsc/shared';
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import { useSessionStore } from '../../../shared/session/store';
import { safeLocalStorage } from './safeStorage';

export const DRAFTS_STORAGE_KEY = 'utmmsc.chat.drafts.v1';
export const RECENT_EMOJI_MAX = 16;
/** Rooms with a saved draft; the least recently edited one is dropped first. */
/** 保存草稿的房间数上限；最久未编辑的先被丢弃。 */
export const DRAFTS_MAX = 50;

export interface ChatDraft {
  text: string;
  quote: QuotePreview | null;
  updatedAt: string;
}

interface PersistedDrafts {
  drafts: Record<string, ChatDraft>;
  recentEmoji: string[];
}

export interface DraftsState extends PersistedDrafts {
  getDraft: (memberId: string, roomId: string) => ChatDraft | null;
  setDraft: (memberId: string, roomId: string, draft: { text: string; quote?: QuotePreview | null }) => void;
  clearDraft: (memberId: string, roomId: string) => void;
  pushRecentEmoji: (emoji: string) => void;
  reset: () => void;
}

const QUOTE_STATES: readonly QuoteState[] = ['ok', 'recalled', 'deleted', 'unavailable'];

/** Drafts are keyed by member as well as room, so one device never shows another member's draft. */
/** 草稿同时按成员和房间区分，同一设备上不会显示其他成员的草稿。 */
export function draftKey(memberId: string, roomId: string): string {
  return `${memberId}|${roomId}`;
}

/** Pure lookup for selectors, for example the conversation list's [草稿] preview. */
/** 供选择器使用的纯查询，例如会话列表中的 [草稿] 预览。 */
export function draftFor(state: Pick<PersistedDrafts, 'drafts'>, memberId: string, roomId: string): ChatDraft | null {
  return state.drafts[draftKey(memberId, roomId)] ?? null;
}

/** Caps text at MESSAGE_TEXT_MAX without leaving half of a surrogate pair at the cut. */
/** 把文字截到 MESSAGE_TEXT_MAX，且不会在截断处留下半个代理对。 */
function capText(text: string): string {
  if (text.length <= MESSAGE_TEXT_MAX) return text;
  const lastCode = text.charCodeAt(MESSAGE_TEXT_MAX - 1);
  const end = lastCode >= 0xd800 && lastCode <= 0xdbff ? MESSAGE_TEXT_MAX - 1 : MESSAGE_TEXT_MAX;
  return text.slice(0, end);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Keeps only the QuotePreview fields, the sticker flag included, and never stores an excerpt for a quote that is no
 * longer visible.
 * 只保留 QuotePreview 的字段（包括表情标记）；对已不可见的引用，绝不保存摘录。
 */
function cleanQuote(value: unknown): QuotePreview | null {
  if (!isRecord(value)) return null;
  const { id, authorId, authorName, excerpt, hasImage, hasSticker, state } = value;
  if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) return null;
  if (typeof authorId !== 'string' || typeof authorName !== 'string' || typeof excerpt !== 'string') return null;
  if (typeof state !== 'string' || !QUOTE_STATES.includes(state as QuoteState)) return null;
  const quote: QuotePreview = {
    id,
    authorId,
    authorName,
    excerpt: excerpt.slice(0, QUOTE_EXCERPT_MAX),
    hasImage: hasImage === true,
    hasSticker: hasSticker === true,
    state: state as QuoteState,
  };
  return redactQuotePreview(quote, quote.state);
}

function cleanDraft(value: unknown): ChatDraft | null {
  if (!isRecord(value) || typeof value.text !== 'string' || typeof value.updatedAt !== 'string') return null;
  const text = capText(value.text);
  const quote = value.quote === null || value.quote === undefined ? null : cleanQuote(value.quote);
  if (!text.trim() && !quote) return null;
  return { text, quote, updatedAt: value.updatedAt };
}

/** Entries are kept in edit order, so equal timestamps still resolve to the most recent edit. */
/** 条目按编辑顺序排列，时间戳相同时仍能分辨出最近一次编辑。 */
function newestDrafts(drafts: Record<string, ChatDraft>): Record<string, ChatDraft> {
  const entries = Object.entries(drafts);
  if (entries.length <= DRAFTS_MAX) return drafts;
  entries.sort((a, b) => (a[1].updatedAt < b[1].updatedAt ? -1 : a[1].updatedAt > b[1].updatedAt ? 1 : 0));
  return Object.fromEntries(entries.slice(-DRAFTS_MAX));
}

/** Rebuilds stored state field by field, so a corrupted or hand-edited entry is dropped instead of crashing. */
/** 逐字段重建已保存的状态，损坏或被手动改过的条目会被丢弃，而不会导致崩溃。 */
function cleanPersisted(value: unknown): PersistedDrafts {
  const drafts: Record<string, ChatDraft> = {};
  const recentEmoji: string[] = [];
  if (!isRecord(value)) return { drafts, recentEmoji };
  if (isRecord(value.drafts)) {
    for (const [key, entry] of Object.entries(value.drafts)) {
      const draft = cleanDraft(entry);
      if (draft) drafts[key] = draft;
    }
  }
  if (Array.isArray(value.recentEmoji)) {
    for (const emoji of value.recentEmoji) {
      if (typeof emoji === 'string' && emoji && emoji.length <= 32 && !recentEmoji.includes(emoji)) recentEmoji.push(emoji);
      if (recentEmoji.length >= RECENT_EMOJI_MAX) break;
    }
  }
  return { drafts: newestDrafts(drafts), recentEmoji };
}

function withoutKey(drafts: Record<string, ChatDraft>, key: string): Record<string, ChatDraft> {
  const next = { ...drafts };
  delete next[key];
  return next;
}

function sameQuote(a: QuotePreview | null, b: QuotePreview | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.id === b.id &&
    a.state === b.state &&
    a.excerpt === b.excerpt &&
    a.hasImage === b.hasImage &&
    (a.hasSticker === true) === (b.hasSticker === true) &&
    a.authorName === b.authorName &&
    a.authorId === b.authorId
  );
}

/**
 * Unsent text, the pending quote and recent emoji, kept in localStorage on this device. Tests pass their
 * own storage; a storage that throws only makes drafts last until the page is closed.
 * 未发送的文字、待发的引用和最近使用的表情，保存在本设备的 localStorage。测试可传入自己的存储；
 * 存储抛错时，草稿只会保留到页面关闭为止。
 */
export function createDraftsStore(storage: StateStorage = safeLocalStorage) {
  return create<DraftsState>()(
    persist(
      (set, get) => ({
        drafts: {},
        recentEmoji: [],
        getDraft: (memberId, roomId) => draftFor(get(), memberId, roomId),
        setDraft: (memberId, roomId, { text, quote = null }) => {
          const key = draftKey(memberId, roomId);
          const nextText = capText(text);
          const nextQuote = quote ? cleanQuote(quote) : null;
          const current = get().drafts[key];
          if (!nextText.trim() && !nextQuote) {
            if (!current) return;
            set({ drafts: withoutKey(get().drafts, key) });
            return;
          }
          if (current && current.text === nextText && sameQuote(current.quote, nextQuote)) return;
          const drafts = { ...withoutKey(get().drafts, key), [key]: { text: nextText, quote: nextQuote, updatedAt: new Date().toISOString() } };
          set({ drafts: newestDrafts(drafts) });
        },
        clearDraft: (memberId, roomId) => {
          const key = draftKey(memberId, roomId);
          if (!get().drafts[key]) return;
          set({ drafts: withoutKey(get().drafts, key) });
        },
        pushRecentEmoji: (emoji) => {
          if (!emoji) return;
          const recent = get().recentEmoji;
          if (recent[0] === emoji) return;
          set({ recentEmoji: [emoji, ...recent.filter((item) => item !== emoji)].slice(0, RECENT_EMOJI_MAX) });
        },
        reset: () => set({ drafts: {}, recentEmoji: [] }),
      }),
      {
        name: DRAFTS_STORAGE_KEY,
        version: 1,
        storage: createJSONStorage(() => storage),
        partialize: (state): PersistedDrafts => ({ drafts: state.drafts, recentEmoji: state.recentEmoji }),
        merge: (persisted, current) => ({ ...current, ...cleanPersisted(persisted) }),
      },
    ),
  );
}

export type DraftsStore = ReturnType<typeof createDraftsStore>;

/** Clears the store when the signed-in member signs out or changes. Returns the unsubscribe function. */
/** 当前登录成员退出或切换时清空 store。返回取消订阅的函数。 */
export function bindDraftsToSession(store: DraftsStore): () => void {
  return useSessionStore.subscribe((state, prev) => {
    const signedOut = prev.token !== null && state.token === null;
    const switched = prev.member !== null && state.member !== null && prev.member.id !== state.member.id;
    if (signedOut || switched) store.getState().reset();
  });
}

export const useDraftsStore = createDraftsStore();
bindDraftsToSession(useDraftsStore);
