import { eventPushPayload } from '../../domain/notifications/payloads';
import type { Env } from '../../env';
import { isMissingSchemaError } from '../d1/channels';
import {
  cancelStaleNotices,
  claimDueNotices,
  claimNotice,
  finishNotice,
  isStaleNotice,
  requeueStuckNotices,
  type EventNoticeRow,
} from '../d1/event-notifications';
import { findEvent } from '../d1/events';
import { pruneSignedOutDevices } from '../d1/push-devices';
import { sendToAllMembers } from './send';

/**
 * Rows claimed per cron run. Each row is one fan-out to every member; small fan-outs run inline, so
 * this also bounds the run's outbound requests.
 * 每次定时任务领取的行数。每行都是一次发给全体成员的推送；小批量推送在本次调用中直接发送，所以这也限制了本次执行的外发请求数。
 */
export const CRON_CLAIM_BATCH = 5;

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Sends a claimed row to every active member whose event switch is on, and records how many were
 * reached. A row whose event is gone is left alone; one that isStaleNotice calls too late is cancelled.
 * 把已领取的行发送给所有开启了活动通知的在用成员，并记录收到的人数。活动已删除的行不作处理；isStaleNotice 判定为太晚的行改为取消。
 */
async function sendClaimedNotice(env: Env, row: EventNoticeRow, now: Date): Promise<void> {
  try {
    const event = await findEvent(env.DB, row.event_id);
    if (!event) return;
    if (isStaleNotice({ kind: row.kind, sendAt: row.send_at }, event.starts_at, now.getTime())) {
      await finishNotice(env.DB, row.id, 'cancelled', null, now);
      return;
    }
    const payload = eventPushPayload({
      event: { id: event.id, title: event.title, startsAt: event.starts_at, location: event.location },
      kind: row.kind,
      now,
      baseUrl: env.APP_BASE_URL,
    });
    const summary = await sendToAllMembers(env, (_memberId, prefs) => (prefs.events ? payload : null));
    // Nobody reached although devices were tried means the push setup is broken, which admins should see.
    // 尝试了设备却没有一人收到，说明推送配置有问题，应让管理员看到。
    const status = summary.devices > 0 && summary.sent === 0 ? 'failed' : 'sent';
    await finishNotice(env.DB, row.id, status, summary.recipients, new Date());
  } catch (err) {
    console.error(`push: event notice ${row.id} failed`, errorText(err));
    await finishNotice(env.DB, row.id, 'failed', null, new Date()).catch(() => undefined);
  }
}

/** Claims one row the way the cron does and sends it; used for the publish notice. Never throws. */
/** 与定时任务相同的方式领取一行并发送；用于发布通知。从不抛出异常。 */
export async function dispatchEventNotice(env: Env, noticeId: string, now: Date = new Date()): Promise<void> {
  try {
    const row = await claimNotice(env.DB, noticeId, now);
    if (row) await sendClaimedNotice(env, row, now);
  } catch (err) {
    if (!isMissingSchemaError(err)) console.error(`push: could not dispatch event notice ${noticeId}`, errorText(err));
  }
}

/**
 * The cron's work: return abandoned rows, cancel stale ones, then claim and send what is due. Once an
 * hour it also drops devices whose sign-in has ended. Before migration 0015 it does nothing.
 * 定时任务的工作：放回被放弃的行，取消过期的行，然后领取并发送到期的行。每小时还会删除一次登录已结束的设备。迁移 0015 之前什么也不做。
 */
export async function runScheduledNotifications(env: Env, now: Date = new Date()): Promise<void> {
  try {
    await requeueStuckNotices(env.DB, now);
    await cancelStaleNotices(env.DB, now);
    const due = await claimDueNotices(env.DB, now, CRON_CLAIM_BATCH);
    for (const row of due) await sendClaimedNotice(env, row, now);
    if (now.getUTCMinutes() < 5) {
      const removed = await pruneSignedOutDevices(env.DB);
      if (removed > 0) console.log(`push: removed ${removed} signed-out devices`);
    }
  } catch (err) {
    if (!isMissingSchemaError(err)) console.error('push: scheduled run failed', errorText(err));
  }
}
