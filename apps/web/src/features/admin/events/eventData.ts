import type { AdminEventRecord } from '@utmmsc/shared';
import { useSessionStore } from '../../../shared/session/store';
import { adminApi } from '../api';
import { adminCache, useAdminQuery, type AdminQuery } from '../state/adminCache';

/** The cache key of the event list (the server sends the latest 200). */
/** 活动列表的缓存键（服务器返回最近的 200 个）。 */
export const EVENTS_KEY = 'events';

/** The publish notice goes out about a second after saving; the list is read again to show the result. */
/** 发布通知在保存后约一秒发出；之后重新读取列表以显示结果。 */
export const PUBLISH_RECHECK_MS = 3000;

const loadEvents = async () => (await adminApi.events()).events;

export function useEvents(): AdminQuery<AdminEventRecord[]> {
  return useAdminQuery(EVENTS_KEY, loadEvents);
}

/**
 * Puts the server's copy of an event in the list, first when it is new. A list not loaded yet stays unloaded, so it
 * still fetches in full rather than showing this one event as the whole list.
 * 把服务器返回的活动放进列表，新活动放在最前。尚未加载的列表保持未加载，因此仍会完整获取，而不是把这一个活动当作整个列表。
 */
export function storeEvent(next: AdminEventRecord): void {
  adminCache.mutate<AdminEventRecord[]>(EVENTS_KEY, (list) => {
    if (!list) return list;
    return list.some((item) => item.id === next.id) ? list.map((item) => (item.id === next.id ? next : item)) : [next, ...list];
  });
}

export function forgetEvent(id: string): void {
  adminCache.mutate<AdminEventRecord[]>(EVENTS_KEY, (list) => list?.filter((item) => item.id !== id));
}

let recheck: ReturnType<typeof setTimeout> | null = null;

/**
 * After saving an event whose publish notice is on its way: the list is read again a moment later, so the notice
 * shows as sent (and how many it reached) without a manual refresh. Kept outside the screens, so it still lands
 * after the admin has moved on.
 * 保存一个发布通知正在发出的活动之后：稍后重新读取列表，通知因此无需手动刷新就显示为已发送（以及覆盖了多少人）。放在界面之外，管理员离开
 * 之后结果仍会到达。
 */
export function recheckPublishNotice(event: AdminEventRecord): void {
  const waiting = (event.notifications ?? []).some((row) => row.kind === 'publish' && (row.status === 'pending' || row.status === 'sending'));
  if (!waiting) return;
  if (recheck !== null) clearTimeout(recheck);
  recheck = setTimeout(() => {
    recheck = null;
    if (useSessionStore.getState().token) void adminCache.load(EVENTS_KEY, loadEvents, { force: true });
  }, PUBLISH_RECHECK_MS);
}
