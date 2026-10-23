import type { Env } from '../../env';
import { fcmAccessToken, parseServiceAccount, sendFcm } from './fcm';
import { deliveryOptions, type DeliveryJob, type DeliveryOutcome, type JobOutcome } from './types';
import { parseVapidPrivateKey, sendWebPush } from './webpush';

/** Pushes in flight at once from one invocation. */
/** 一次调用中同时进行的推送数。 */
export const PUSH_CONCURRENCY = 10;

/** Runs fn over items with at most `limit` running at once; results keep the input order. fn must not throw. */
/** 以最多 `limit` 个并发对 items 执行 fn，结果保持输入顺序。fn 不得抛出异常。 */
export async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index] as T);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Sends each job to its push service and reports what happened. Missing credentials skip that kind of
 * device with one log line; nothing here touches the database.
 * 把每个任务发往对应的推送服务并报告结果。缺少凭据时跳过该类设备并只记录一行日志；这里不访问数据库。
 */
export async function deliverJobs(env: Env, jobs: readonly DeliveryJob[]): Promise<JobOutcome[]> {
  if (jobs.length === 0) return [];
  const webJobs = jobs.filter((job) => job.kind === 'webpush');
  const fcmJobs = jobs.filter((job) => job.kind === 'fcm');

  const vapidKey = webJobs.length > 0 ? parseVapidPrivateKey(env.VAPID_PRIVATE_KEY) : null;
  if (webJobs.length > 0 && !vapidKey) console.warn(`push: VAPID_PRIVATE_KEY is missing or unreadable; skipped ${webJobs.length} web devices`);

  const account = fcmJobs.length > 0 ? parseServiceAccount(env.FCM_SERVICE_ACCOUNT) : null;
  if (fcmJobs.length > 0 && !account) console.warn(`push: FCM_SERVICE_ACCOUNT is missing or unreadable; skipped ${fcmJobs.length} Android devices`);
  const accessToken = account ? await fcmAccessToken(account) : null;

  const outcomes = new Map<string, DeliveryOutcome>();
  const runnable: DeliveryJob[] = [];
  for (const job of jobs) {
    if (job.kind === 'webpush' && !vapidKey) outcomes.set(job.deviceId, 'skipped');
    else if (job.kind === 'fcm' && !account) outcomes.set(job.deviceId, 'skipped');
    else if (job.kind === 'fcm' && !accessToken) outcomes.set(job.deviceId, 'transient');
    else runnable.push(job);
  }

  await mapWithConcurrency(runnable, PUSH_CONCURRENCY, async (job) => {
    const options = deliveryOptions(job.payload.kind);
    let outcome: DeliveryOutcome;
    try {
      outcome =
        job.kind === 'webpush'
          ? await sendWebPush(vapidKey as JsonWebKey, job, options)
          : await sendFcm(account as NonNullable<typeof account>, accessToken as string, job, options);
    } catch {
      outcome = 'transient';
    }
    outcomes.set(job.deviceId, outcome);
  });
  return jobs.map((job) => ({ deviceId: job.deviceId, outcome: outcomes.get(job.deviceId) ?? 'transient' }));
}
