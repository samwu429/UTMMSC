import { Hono } from 'hono';
import { isMissingSchemaError } from '../../../infrastructure/d1/channels';
import type { AppEnv } from '../../context';
import { errorResponse } from '../../errors';
import { requireSession } from '../../middleware/session';
import { momentsUnavailable } from './common';
import { interactionRoutes } from './interactions';
import { moderationRoutes } from './moderation';
import { noticeRoutes } from './notices';
import { postRoutes } from './posts';
import { safetyRoutes } from './safety';

/**
 * 好友动态, mounted at /moments. Every route needs a session, acts as the member's viewed role and has its own
 * per-member limit. No path has a bare /:id at the root, and there is no PUT, which CORS does not allow.
 * 好友动态，挂载在 /moments。每个接口都需要登录，按成员当前查看的身份执行，并有各自按成员计算的频率限制。
 * 根路径下没有单独的 /:id，也没有 CORS 不允许的 PUT。
 */
export const momentRoutes = new Hono<AppEnv>();

// Before migration 0016 every moments table is missing; answer that the feature is being upgraded instead of 500.
// 迁移 0016 之前好友动态的表都不存在；此时回答功能正在升级，而不是 500。
momentRoutes.onError((err, c) => errorResponse(isMissingSchemaError(err) ? momentsUnavailable() : err, c));

momentRoutes.use('*', requireSession);
momentRoutes.route('/', postRoutes);
momentRoutes.route('/', interactionRoutes);
momentRoutes.route('/', noticeRoutes);
momentRoutes.route('/', safetyRoutes);
momentRoutes.route('/', moderationRoutes);
