import type { AdminCountKey, AdminCounts } from '@utmmsc/shared';
import { isMissingSchemaError } from './channels';
import { nowIso } from './time';

/**
 * The counts behind GET /admin/summary: work waiting for someone (applications, year requests, open reports) and
 * the overview numbers. Only the queries for the counts asked for run, all in one batch.
 * GET /admin/summary 背后的计数：等待处理的事项（入会申请、入学年份申请、未处理的投诉）以及概况数字。只执行所请求计数对应的查询，并合并为一个批次。
 */

export interface AdminCountContext {
  /** The member asking. Reports about their own content are left out, as in the report queue. */
  /** 发起请求的成员。与投诉队列一样，不计入针对其本人内容的投诉。 */
  viewerId: string;
  /** Events from this instant on count as upcoming; invites expiring after it are open. */
  /** 从此刻起开始的活动算作即将开始；在此之后才过期的邀请算作未使用。 */
  now: string;
}

interface CountRow {
  n: number;
  status?: string;
}

interface CountQuery {
  /** The counts this query answers. */
  /** 这条查询给出的计数。 */
  keys: readonly AdminCountKey[];
  statement(db: D1Database, context: AdminCountContext): D1PreparedStatement;
  /** The counts read from the result rows; no rows reads as 0, which is also what a missing table gives. */
  /** 从结果行读出的计数；没有行时为 0，表不存在时也是如此。 */
  read(rows: readonly CountRow[]): AdminCounts;
}

function total(rows: readonly CountRow[]): number {
  return Number(rows[0]?.n ?? 0);
}

function single(key: AdminCountKey, sql: string, params: (context: AdminCountContext) => unknown[] = () => []): CountQuery {
  return {
    keys: [key],
    statement: (db, context) => db.prepare(sql).bind(...params(context)),
    read: (rows) => ({ [key]: total(rows) }),
  };
}

const COUNT_QUERIES: readonly CountQuery[] = [
  single('pendingApplications', "SELECT COUNT(*) AS n FROM manual_applications WHERE status = 'pending'"),
  // Joined like the review list, so the count matches the rows it shows.
  // 与审核列表一样连接成员表，计数与列表中的行一致。
  single(
    'pendingYearRequests',
    "SELECT COUNT(*) AS n FROM enrollment_year_requests r JOIN members m ON m.id = r.member_id WHERE r.status = 'pending'",
  ),
  single('openReports', "SELECT COUNT(*) AS n FROM moment_reports WHERE status = 'open' AND target_member_id <> ?", (context) => [context.viewerId]),
  {
    // Announcement emails go to every active member, so the same row gives the recipient count.
    // 公告邮件发给每一位在用成员，因此同一行也给出收件人数。
    keys: ['activeMembers', 'disabledMembers', 'announcementRecipients'],
    statement: (db) => db.prepare('SELECT status, COUNT(*) AS n FROM members GROUP BY status'),
    read: (rows) => {
      const of = (status: string) => Number(rows.find((row) => row.status === status)?.n ?? 0);
      return { activeMembers: of('active'), disabledMembers: of('disabled'), announcementRecipients: of('active') };
    },
  },
  single('channels', 'SELECT COUNT(*) AS n FROM channels'),
  single('upcomingEvents', 'SELECT COUNT(*) AS n FROM events WHERE starts_at >= ?', (context) => [context.now]),
  single('openInvites', 'SELECT COUNT(*) AS n FROM advisor_invites WHERE consumed_at IS NULL AND expires_at > ?', (context) => [context.now]),
];

async function rowsAlone(query: CountQuery, db: D1Database, context: AdminCountContext): Promise<CountRow[]> {
  try {
    return (await query.statement(db, context).all<CountRow>()).results;
  } catch (err) {
    if (isMissingSchemaError(err)) return [];
    throw err;
  }
}

/**
 * The requested counts and nothing else. A database before the migration that adds a table (moment_reports in 0016,
 * advisor_invites in 0010) counts that table as 0: one missing table fails the whole batch, so the queries then run
 * one by one.
 * 只返回所请求的计数。数据库尚未执行添加某张表的迁移时（0016 的 moment_reports、0010 的 advisor_invites），该表计为 0：
 * 一张表不存在会让整个批次失败，因此这时逐条执行查询。
 */
export async function loadAdminCounts(
  db: D1Database,
  keys: readonly AdminCountKey[],
  context: AdminCountContext = { viewerId: '', now: nowIso() },
): Promise<AdminCounts> {
  const wanted = new Set(keys);
  const queries = COUNT_QUERIES.filter((query) => query.keys.some((key) => wanted.has(key)));
  if (queries.length === 0) return {};
  let results: CountRow[][];
  try {
    results = (await db.batch<CountRow>(queries.map((query) => query.statement(db, context)))).map((result) => result.results);
  } catch (err) {
    if (!isMissingSchemaError(err)) throw err;
    results = await Promise.all(queries.map((query) => rowsAlone(query, db, context)));
  }
  const counts: AdminCounts = {};
  queries.forEach((query, i) => {
    const read = query.read(results[i] ?? []);
    for (const key of query.keys) if (wanted.has(key)) counts[key] = read[key] ?? 0;
  });
  return counts;
}
