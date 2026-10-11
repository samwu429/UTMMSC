import type { Env } from './env';
import { createApp } from './http/app';

export { ChatRoom } from './realtime/rooms/chat-room';

const app = createApp();

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => app.fetch(request, env, ctx),
} satisfies ExportedHandler<Env>;
