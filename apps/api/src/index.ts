import type { Env } from './env';
import { createApp } from './http/app';
import { runScheduledNotifications } from './infrastructure/push/event-notices';

export { ChatRoom } from './realtime/rooms/chat-room';
export { PushRelay } from './infrastructure/push/relay';

const app = createApp();

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => app.fetch(request, env, ctx),
  // Every five minutes: event notices that are due, and housekeeping for push devices.
  // 每五分钟一次：发送到期的活动通知，并整理推送设备。
  scheduled: (controller: ScheduledController, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(runScheduledNotifications(env, new Date(controller.scheduledTime)));
  },
} satisfies ExportedHandler<Env>;
