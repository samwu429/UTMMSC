import type { Env } from './env';
import { createApp } from './http/app';
import { runMomentsMaintenance } from './infrastructure/d1/moment-maintenance';
import { runScheduledNotifications } from './infrastructure/push/event-notices';

export { ChatRoom } from './realtime/rooms/chat-room';
export { PushRelay } from './infrastructure/push/relay';

const app = createApp();

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => app.fetch(request, env, ctx),
  // Every five minutes: event notices that are due, housekeeping for push devices, and moments uploads no post used.
  // 每五分钟一次：发送到期的活动通知，整理推送设备，并清理没有动态使用的好友动态上传文件。
  scheduled: (controller: ScheduledController, env: Env, ctx: ExecutionContext) => {
    const now = new Date(controller.scheduledTime);
    ctx.waitUntil(runScheduledNotifications(env, now));
    ctx.waitUntil(runMomentsMaintenance(env, now));
  },
} satisfies ExportedHandler<Env>;
