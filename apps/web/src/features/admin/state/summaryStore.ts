import { create } from 'zustand';
import type { AdminCountKey, AdminCounts, AdminSummaryResponse } from '@utmmsc/shared';
import { ApiClientError } from '../../../shared/api/errors';
import { useSessionStore } from '../../../shared/session/store';
import { adminApi } from '../api';

/**
 * GET /admin/summary for the dashboard, the sidebar and the 发现 → 管理 badge. Refreshed on entering admin, on every
 * 发现 visit and after each admin change. A server without the endpoint (404) leaves the counts hidden; any other
 * failure keeps the last counts. Imported by the 发现 page, so it stays small and pulls in no admin screens.
 * 管理首页、侧边栏和「发现 → 管理」角标所用的 GET /admin/summary。进入管理后台、每次打开「发现」以及每次在后台做出修改后刷新。
 * 服务器没有该接口（404）时不显示计数；其他失败保留上一次的计数。「发现」页会导入本文件，所以它保持精简，不引入任何管理界面。
 */

export type AdminSummaryStatus = 'idle' | 'ready' | 'unavailable' | 'failed';

export interface AdminSummaryState {
  counts: AdminCounts;
  /** ready: counts from the server. unavailable: the server has no summary yet, so nothing is shown. */
  /** ready：来自服务器的计数。unavailable：服务器尚无该接口，因此什么都不显示。 */
  status: AdminSummaryStatus;
  loading: boolean;
  /**
   * Asks the server unless an answer came within `maxAgeMs` (SUMMARY_MIN_GAP_MS by default). `force` always asks,
   * and asks once more after a request in flight that may predate the change.
   * 除非 `maxAgeMs`（默认 SUMMARY_MIN_GAP_MS）内已有结果，否则向服务器查询。`force` 总是查询；若正在进行的请求可能早于这次改动，
   * 之后会再查询一次。
   */
  refresh(options?: { force?: boolean; maxAgeMs?: number }): Promise<void>;
  /** A change made here moves a count at once, before the server confirms it. */
  /** 在这里做出的改动立即调整计数，不等服务器确认。 */
  adjust(key: AdminCountKey, delta: number): void;
  /** Sign-out, another member, or another viewed role. */
  /** 退出登录、换了成员或换了当前视角的身份。 */
  reset(): void;
}

export interface AdminSummaryApi {
  summary(): Promise<AdminSummaryResponse>;
}

/** Unforced refreshes closer together than this share the last answer. */
/** 间隔短于此的非强制刷新沿用上一次的结果。 */
export const SUMMARY_MIN_GAP_MS = 10_000;

export function createAdminSummaryStore(api: AdminSummaryApi, now: () => number = Date.now) {
  let generation = 0;
  let inflight: Promise<void> | null = null;
  let again = false;
  let answeredAt: number | null = null;
  /** Bumped by adjust; an answer to a request that started before the last adjust cannot know about it. */
  /** 每次 adjust 递增；在最后一次 adjust 之前发出的请求，其结果不可能包含这次调整。 */
  let localSeq = 0;

  return create<AdminSummaryState>()((set, get) => {
    function load(): Promise<void> {
      const startGeneration = generation;
      const startSeq = localSeq;
      set({ loading: true });
      return api
        .summary()
        .then((res) => {
          if (startGeneration !== generation) return;
          answeredAt = now();
          if (startSeq !== localSeq) {
            again = true;
            return;
          }
          set({ counts: res.counts ?? {}, status: 'ready' });
        })
        .catch((error: unknown) => {
          if (startGeneration !== generation) return;
          answeredAt = now();
          if (error instanceof ApiClientError && error.status === 404) set({ counts: {}, status: 'unavailable' });
          else if (get().status !== 'ready') set({ status: 'failed' });
        })
        .finally(() => {
          if (startGeneration !== generation) return;
          inflight = null;
          if (again) {
            again = false;
            inflight = load();
            return;
          }
          set({ loading: false });
        });
    }

    return {
      counts: {},
      status: 'idle',
      loading: false,
      refresh(options = {}) {
        if (!useSessionStore.getState().token) return Promise.resolve();
        if (inflight) {
          if (options.force) again = true;
          return inflight;
        }
        const maxAge = options.maxAgeMs ?? SUMMARY_MIN_GAP_MS;
        if (!options.force && answeredAt !== null && now() - answeredAt < maxAge) return Promise.resolve();
        inflight = load();
        return inflight;
      },
      adjust(key, delta) {
        const { counts, status } = get();
        if (status !== 'ready' || counts[key] === undefined) return;
        localSeq += 1;
        set({ counts: { ...counts, [key]: Math.max(0, (counts[key] ?? 0) + delta) } });
      },
      reset() {
        generation += 1;
        inflight = null;
        again = false;
        answeredAt = null;
        set({ counts: {}, status: 'idle', loading: false });
      },
    };
  });
}

export type AdminSummaryStore = ReturnType<typeof createAdminSummaryStore>;

/**
 * Empties the summary when the member signs out, another member signs in or the viewed role changes, since the
 * counts are those of the viewed role. Returns the unsubscribe function.
 * 成员退出、换了一个成员登录或当前视角的身份改变时清空摘要，因为计数属于当前视角的身份。返回取消订阅的函数。
 */
export function bindAdminSummaryToSession(store: AdminSummaryStore): () => void {
  return useSessionStore.subscribe((state, prev) => {
    const signedOut = prev.token !== null && state.token === null;
    const switched = prev.member !== null && state.member !== null && prev.member.id !== state.member.id;
    const roleChanged = prev.member !== null && state.member !== null && prev.member.role !== state.member.role;
    if (signedOut || switched || roleChanged) store.getState().reset();
  });
}

export const useAdminSummary = createAdminSummaryStore(adminApi);
bindAdminSummaryToSession(useAdminSummary);

/** After an admin change: asks again now, so every badge catches up. */
/** 在后台做出修改之后：立即重新查询，让所有角标跟上。 */
export function refreshAdminSummary(): void {
  void useAdminSummary.getState().refresh({ force: true });
}

/** The counts, or null while there are none to show (not loaded yet, failed first time, or no endpoint). */
/** 计数；尚无可显示的计数（未加载、首次失败或没有该接口）时为 null。 */
export function useAdminCounts(): AdminCounts | null {
  const counts = useAdminSummary((s) => s.counts);
  const ready = useAdminSummary((s) => s.status === 'ready');
  return ready ? counts : null;
}
