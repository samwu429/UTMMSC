import type { AdminAnnouncementsResponse } from '@utmmsc/shared';
import { ApiClientError } from '../../../shared/api/errors';
import { useSessionStore } from '../../../shared/session/store';
import { adminApi } from '../api';
import { adminCache, useAdminQuery, type AdminQuery } from '../state/adminCache';
import { appendAnnouncements, keepLoadedPages } from './announcementRules';

/** The cache key of the history, holding every page loaded so far. */
/** 公告记录的缓存键，保存目前已加载的所有分页。 */
export const ANNOUNCEMENTS_KEY = 'announcements';

export interface AnnouncementHistory extends AdminAnnouncementsResponse {
  /** The server has no history route yet (404), so the screen says so instead of showing an empty list. */
  /** 服务器还没有记录接口（404），界面因此直接说明，而不是显示空列表。 */
  unavailable: boolean;
}

/**
 * The loader of the history: the first page, followed by the older pages already in the cache. A reload (stale
 * after 30 s, or marked stale by load more) would otherwise cut the history back to 20 rows, and a row further back
 * would turn into 找不到这条公告. The cache is read after the fetch, so pages added while it was on its way are kept.
 * 记录的加载函数：第一页，后面接上缓存里已有的更早分页。否则重新加载（30 秒后过期，或被「加载更多」标为过期）会把记录截回 20 条，
 * 更早的一条就会变成「找不到这条公告」。缓存在请求返回之后才读取，因此请求途中加进来的分页也会保留。
 */
export async function loadAnnouncementHistory(): Promise<AnnouncementHistory> {
  try {
    const res = await adminApi.announcements();
    const loaded = adminCache.read<AnnouncementHistory>(ANNOUNCEMENTS_KEY).data;
    return { ...keepLoadedPages(res, loaded && !loaded.unavailable ? loaded : null), unavailable: false };
  } catch (err) {
    if (err instanceof ApiClientError && err.status === 404) return { announcements: [], nextCursor: null, unavailable: true };
    throw err;
  }
}

export function useAnnouncements(): AdminQuery<AnnouncementHistory> {
  return useAdminQuery(ANNOUNCEMENTS_KEY, loadAnnouncementHistory);
}

/**
 * Loads the page after `cursor` and adds it to the cached history, but only while the history still ends at that
 * cursor. A reload that landed meanwhile may have replaced the rows, and the page would then leave a gap.
 * 加载 `cursor` 之后的一页，并接到缓存的记录后面，但仅当记录仍然停在这个游标时。期间完成的重新加载可能已经换掉了这些行，
 * 这一页接上去就会留下空缺。
 */
export async function loadMoreAnnouncements(cursor: string): Promise<void> {
  const res = await adminApi.announcements(cursor);
  if (adminCache.read<AnnouncementHistory>(ANNOUNCEMENTS_KEY).data?.nextCursor !== cursor) return;
  adminCache.mutate<AnnouncementHistory>(ANNOUNCEMENTS_KEY, (page) => (page ? { ...appendAnnouncements(page, res), unavailable: false } : page));
}

/** A new announcement went out: the history loads again when next shown. */
/** 发出了一条新公告：下次显示时重新加载记录。 */
export function invalidateAnnouncements(): void {
  adminCache.invalidate(ANNOUNCEMENTS_KEY);
}

/** What was typed in the compose screen, kept while the admin looks elsewhere. */
/** 撰写界面中已输入的内容，在管理员查看别处时保留。 */
export interface AnnouncementDraft {
  title: string;
  body: string;
  sendEmail: boolean;
}

/**
 * The unsent draft, one per member and only in memory: leaving the compose screen and coming back keeps the text,
 * a reload or another member does not see it, and sending empties it.
 * 未发送的草稿，每位成员一份，只保存在内存中：离开撰写界面再回来时文字仍在；刷新页面或换了成员时看不到；发送后清空。
 */
let saved: { memberId: string; draft: AnnouncementDraft } | null = null;

export function emptyAnnouncementDraft(): AnnouncementDraft {
  // Email is on by default, because email is the only way members see an announcement today.
  // 默认发送邮件，因为目前邮件是成员能看到公告的唯一途径。
  return { title: '', body: '', sendEmail: true };
}

export function readAnnouncementDraft(): AnnouncementDraft {
  const memberId = useSessionStore.getState().member?.id;
  return saved && memberId && saved.memberId === memberId ? saved.draft : emptyAnnouncementDraft();
}

export function keepAnnouncementDraft(draft: AnnouncementDraft): void {
  const memberId = useSessionStore.getState().member?.id;
  saved = memberId ? { memberId, draft } : null;
}

export function clearAnnouncementDraft(): void {
  saved = null;
}
