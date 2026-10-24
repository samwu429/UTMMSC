import { Hono } from 'hono';
import { MOMENT_NOTICE_PAGE, type MomentBadgeResponse, type MomentNoticesResponse } from '@utmmsc/shared';
import { readUpTo } from '../../../domain/moments/input';
import {
  clearMomentNotices,
  listMomentNotices,
  markMomentFeedSeen,
  markMomentNoticesRead,
  readMomentBadge,
} from '../../../infrastructure/d1/moment-notices';
import { nowIso } from '../../../infrastructure/d1/time';
import type { AppEnv } from '../../context';
import { memberRateLimit } from '../../middleware/rate-limit';
import { readJson } from '../../validation';
import { MINUTE, cursorOut, mediaToken, readCursor, readInput, readerOf } from './common';

/** 消息, the 发现 badge and how far the home feed has been read. Every route acts on the member's own rows. */
/** 「消息」、「发现」上的标记，以及动态首页读到了哪里。每个接口只处理成员自己的记录。 */
export const noticeRoutes = new Hono<AppEnv>();

/** ?unread=1 lists unread notices only, as 消息 does when opened from the bubble. */
/** ?unread=1 时只列出未读消息，与从气泡打开「消息」时一样。 */
noticeRoutes.get('/notices', memberRateLimit('moments:notices', 120, MINUTE), async (c) => {
  const cursor = readCursor(c.req.query('cursor'));
  const unreadOnly = c.req.query('unread') === '1';
  const page = await listMomentNotices(c.env.DB, readerOf(c.get('member')), { cursor, unreadOnly, limit: MOMENT_NOTICE_PAGE });
  const response: MomentNoticesResponse = {
    notices: page.notices,
    nextCursor: cursorOut(page.nextCursor),
    unread: page.unread,
    mediaToken: await mediaToken(c),
  };
  return c.json(response);
});

noticeRoutes.post('/notices/read', memberRateLimit('moments:notices-read', 60, MINUTE), async (c) => {
  const body = await readJson<Record<string, unknown>>(c);
  const upTo = readInput(() => readUpTo(body));
  const unread = await markMomentNoticesRead(c.env.DB, c.get('member').id, upTo);
  return c.json({ unread });
});

/** Clear all. */
/** 清空。 */
noticeRoutes.delete('/notices', memberRateLimit('moments:notices-clear', 10, MINUTE), async (c) => {
  await clearMomentNotices(c.env.DB, c.get('member').id);
  return c.json({ ok: true });
});

noticeRoutes.get('/badge', memberRateLimit('moments:badge', 120, MINUTE), async (c) => {
  const response: MomentBadgeResponse = await readMomentBadge(c.env.DB, readerOf(c.get('member')));
  return c.json(response);
});

/**
 * The newest post time the member has seen on the home feed. A time ahead of the server's clock is pulled
 * back to now, so a bad value can never hide the dot for posts that have not been written yet.
 * 成员在动态首页看到的最新动态时间。晚于服务器时钟的时间会改为现在，错误的值因此不会让之后才发表的动态不显示红点。
 */
noticeRoutes.post('/seen', memberRateLimit('moments:seen', 60, MINUTE), async (c) => {
  const body = await readJson<Record<string, unknown>>(c);
  const requested = readInput(() => readUpTo(body));
  const now = nowIso();
  await markMomentFeedSeen(c.env.DB, c.get('member').id, requested > now ? now : requested);
  return c.json({ ok: true });
});
