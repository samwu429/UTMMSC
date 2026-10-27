import type { Env } from './env';
import { runMomentsMaintenance } from './infrastructure/d1/moment-maintenance';
import { runStickerMaintenance } from './infrastructure/d1/sticker-maintenance';
import { runScheduledNotifications } from './infrastructure/push/event-notices';
import { runTimetableReminders } from './infrastructure/push/timetable-reminders';

/**
 * The Worker's three cron triggers (wrangler.jsonc) and the jobs each one runs. Each trigger is its own invocation
 * with its own limits, so the minute's timetable reminders never wait behind an event fan-out, and the hourly
 * sticker sweep has its own query budget.
 * Worker 的三个定时触发器（wrangler.jsonc）以及各自运行的工作。每个触发器都是一次独立的调用，拥有各自的限额，
 * 因此每分钟的课表提醒从不排在活动群发之后等待，每小时一次的表情清理也有自己的查询额度。
 */

/** Every minute: timetable class and assignment reminders. */
/** 每分钟：课表的上课提醒和作业提醒。 */
export const TIMETABLE_CRON = '* * * * *';
/** Every five minutes: event notices, push-device housekeeping and moments uploads no post used. */
/** 每五分钟：活动通知、推送设备整理，以及清理没有动态使用的好友动态上传文件。 */
export const EVENTS_CRON = '*/5 * * * *';
/** Every hour at minute 17, which no other job uses: the sticker sweep. */
/** 每小时第 17 分钟（其他工作都不用这个时间）：表情清理。 */
export const STICKERS_CRON = '17 * * * *';

export type ScheduledJob = 'timetable' | 'events' | 'moments' | 'stickers';

/**
 * The jobs for a trigger. The minute trigger runs the timetable job and the hourly trigger the sticker sweep; anything
 * else, including a manual /__scheduled call without a cron, runs the five-minute jobs exactly as before the
 * timetable existed; the hourly device prune and the event-notice timing depend on that cadence.
 * 某个触发器要运行的工作。每分钟的触发器运行课表工作，每小时的触发器运行表情清理；其他任何触发（包括不带 cron 的手动 /__scheduled 调用）
 * 都与课表出现之前完全一样，运行五分钟一次的工作；每小时一次的设备清理和活动通知的时间都依赖这个节奏。
 */
export function scheduledJobs(cron: string): ScheduledJob[] {
  const normalized = cron.trim().split(/\s+/).join(' ');
  if (normalized === TIMETABLE_CRON) return ['timetable'];
  if (normalized === STICKERS_CRON) return ['stickers'];
  return ['events', 'moments'];
}

/** Runs one job for the cron time `now`. Each job logs its own failures and never throws. */
/** 针对定时时间 `now` 运行一项工作。每项工作自行记录失败，从不抛出异常。 */
export async function runScheduledJob(job: ScheduledJob, env: Env, now: Date): Promise<void> {
  switch (job) {
    case 'timetable':
      await runTimetableReminders(env, now);
      return;
    case 'events':
      await runScheduledNotifications(env, now);
      return;
    case 'moments':
      await runMomentsMaintenance(env, now);
      return;
    case 'stickers':
      await runStickerMaintenance(env, now);
      return;
  }
}
