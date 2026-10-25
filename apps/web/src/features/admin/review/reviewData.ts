import type { ManualApplication } from '@utmmsc/shared';
import { ApiClientError } from '../../../shared/api/errors';
import { adminApi, type AdminYearRequest, type ReviewDecision } from '../api';
import { adminCache, useAdminQuery, type AdminQuery } from '../state/adminCache';
import { refreshAdminSummary, useAdminSummary } from '../state/summaryStore';
import { oldestFirst, withoutId, type ReviewKind } from './reviewQueue';

/** The cache key of each queue. */
/** 每个队列的缓存键。 */
export const REVIEW_KEYS: Record<ReviewKind, string> = { applications: 'applications', years: 'yearRequests' };

const loadApplications = async () => oldestFirst((await adminApi.applications()).applications);
const loadYearRequests = async () => oldestFirst((await adminApi.enrollmentYearRequests()).requests);

export function useApplications(enabled: boolean): AdminQuery<ManualApplication[]> {
  return useAdminQuery(REVIEW_KEYS.applications, loadApplications, { enabled });
}

export function useYearRequests(enabled: boolean): AdminQuery<AdminYearRequest[]> {
  return useAdminQuery(REVIEW_KEYS.years, loadYearRequests, { enabled });
}

/** Handled elsewhere already: another reviewer decided it first. */
/** 已在别处处理：另一位审核人先做了决定。 */
function alreadyHandled(error: unknown): boolean {
  return error instanceof ApiClientError && error.status === 404;
}

function dropFromQueue(kind: ReviewKind, id: string): void {
  adminCache.mutate<{ id: string }[]>(REVIEW_KEYS[kind], (list) => withoutId(list, id));
  useAdminSummary.getState().adjust(kind === 'applications' ? 'pendingApplications' : 'pendingYearRequests', -1);
  // An approval adds a member or changes an enrollment year, so the member list is out of date.
  // 通过会新增成员或修改入学年份，因此成员列表已过期。
  adminCache.invalidate('members');
}

/**
 * Sends one decision (both kinds email the person) and takes the item out of its queue and the counts. An item
 * someone else decided first leaves the queue too, and the server's message is passed on. `refresh: false` leaves
 * the summary request to the caller, for a batch.
 * 发送一个决定（两类都会给对方发邮件），并把该项移出队列和计数。别人先处理掉的一项同样移出队列，并转交服务器的提示。`refresh: false`
 * 把摘要请求留给调用方，用于批量处理。
 */
export async function decideReview(kind: ReviewKind, id: string, decision: ReviewDecision, { refresh = true }: { refresh?: boolean } = {}): Promise<void> {
  try {
    if (kind === 'applications') await adminApi.decide(id, decision);
    else await adminApi.decideEnrollmentYear(id, decision);
  } catch (error) {
    if (alreadyHandled(error)) {
      dropFromQueue(kind, id);
      if (refresh) refreshAdminSummary();
    }
    throw error;
  }
  dropFromQueue(kind, id);
  if (refresh) refreshAdminSummary();
}
