import type { Env } from './env';
import { createApp } from './http/app';
import { runScheduledJob, scheduledJobs } from './scheduled';

export { ChatRoom } from './realtime/rooms/chat-room';
export { PushRelay } from './infrastructure/push/relay';

const app = createApp();

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => app.fetch(request, env, ctx),
  // Every minute: timetable class and assignment reminders. Every five minutes, in an invocation of its own: event
  // notices that are due, housekeeping for push devices, and moments uploads no post used.
  // 每分钟一次：课表的上课提醒和作业提醒。每五分钟一次（在单独的一次调用中）：发送到期的活动通知，整理推送设备，并清理没有动态使用的好友动态上传文件。
  scheduled: (controller: ScheduledController, env: Env, ctx: ExecutionContext) => {
    const now = new Date(controller.scheduledTime);
    for (const job of scheduledJobs(controller.cron)) ctx.waitUntil(runScheduledJob(job, env, now));
  },
} satisfies ExportedHandler<Env>;
