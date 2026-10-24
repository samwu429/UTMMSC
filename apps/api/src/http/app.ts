import { Hono } from 'hono';
import type { AppEnv } from './context';
import { errorResponse } from './errors';
import { corsMiddleware } from './middleware/cors';
import { adminRoutes } from './routes/admin';
import { authRoutes } from './routes/auth';
import { channelRoutes } from './routes/channels';
import { chatRoutes } from './routes/chat';
import { fileRoutes } from './routes/files';
import { friendRoutes } from './routes/friends';
import { homeRoutes } from './routes/home';
import { memberRoutes } from './routes/members';
import { miniappRoutes } from './routes/miniapps';
import { momentRoutes } from './routes/moments';
import { notificationRoutes } from './routes/notifications';
import { serveMemberMedia } from './routes/members/media';

/** Composes all route groups under one Hono app with shared CORS and error handling. */
/** 将所有路由组装到一个 Hono 应用，共享 CORS 与错误处理。 */
export function createApp() {
  const app = new Hono<AppEnv>();
  app.use('*', corsMiddleware);
  app.onError(errorResponse);
  app.notFound((c) => c.json({ error: { code: 'not_found', message: '接口不存在' } }, 404));

  app.get('/', (c) => c.json({ service: 'utmmsc-api', status: 'ok' }));
  app.route('/auth', authRoutes);
  // Registered before the session-protected member routes so image and video tags can use a media token.
  // 放在需要登录的成员路由之前，图片和视频标签才能用媒体令牌访问。
  app.get('/members/media/*', serveMemberMedia);
  app.route('/members', memberRoutes);
  app.route('/chat', chatRoutes);
  app.route('/channels', channelRoutes);
  app.route('/files', fileRoutes);
  app.route('/friends', friendRoutes);
  app.route('/home', homeRoutes);
  app.route('/miniapps', miniappRoutes);
  app.route('/moments', momentRoutes);
  app.route('/notifications', notificationRoutes);
  app.route('/admin', adminRoutes);
  return app;
}
