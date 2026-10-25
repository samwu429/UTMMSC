import { cors } from 'hono/cors';
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../context';

const LOCAL_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

/**
 * How long a browser may reuse a preflight answer: two hours, Chromium's cap (Firefox allows a day, Safari
 * ten minutes). Each new URL otherwise costs a full extra round trip before the real request.
 * 浏览器可以复用预检结果的时长：两小时，即 Chromium 的上限（Firefox 允许一天，Safari 十分钟）。否则每个新地址都要在真正的请求之前多一次完整往返。
 */
export const PREFLIGHT_MAX_AGE_SECONDS = 7200;

/**
 * Only the published front end and local dev servers may call the API from a browser.
 * APP_ORIGIN is a comma-separated list so the custom domain and the github.io alias both work.
 * 只有已发布的前端与本地开发服务器可从浏览器调用接口。APP_ORIGIN 为逗号分隔列表，自定义域名与 github.io 别名都可用。
 */
export const corsMiddleware: MiddlewareHandler<AppEnv> = (c, next) =>
  cors({
    origin: (origin) => {
      if (!origin) return null;
      const allowed = c.env.APP_ORIGIN.split(',').map((o) => o.trim());
      if (allowed.includes(origin) || LOCAL_ORIGINS.includes(origin)) return origin;
      return null;
    },
    allowHeaders: ['authorization', 'content-type', 'x-file-name'],
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    maxAge: PREFLIGHT_MAX_AGE_SECONDS,
  })(c, next);
