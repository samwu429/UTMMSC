import {
  ASSIGNMENT_OFFSETS,
  REMINDER_EXPIRY_MARGIN_MS,
  type AssignmentOffset,
  type ClassLead,
  type ClassSlot,
  type MeetingKind,
  type TimetableLocale,
  type Weekday,
  type WeekRule,
} from '@utmmsc/shared';

/**
 * The timetable reminder ledger (timetable_reminders) as the minute cron uses it. A class row is written when a run
 * claims an occurrence, so one class is reminded once; an assignment row is planned when the assignment is saved.
 * Every list of ids or rows is bound as one JSON parameter and read with json_each, so no statement comes near
 * D1's 100-parameter limit.
 * 每分钟定时任务所用的课表提醒记录（timetable_reminders）。上课提醒在某次运行领取一次课时写入，因此同一次课只提醒一次；
 * 作业提醒在保存作业时安排。所有 id 或记录列表都作为一个 JSON 参数绑定并用 json_each 读取，任何语句都远低于 D1 每条语句 100 个参数的上限。
 */

const MINUTE_MS = 60_000;

/** A row is sent at most this many times. */
/** 一行最多发送这么多次。 */
export const REMINDER_ATTEMPTS_MAX = 3;
/** A claimed row still sending after this long was abandoned by a run that died, and is put back. */
/** 领取后这么久仍在发送中的行，说明领取它的运行已中断，会被放回。 */
export const REMINDER_STUCK_AFTER_MS = 3 * MINUTE_MS;
/** Due rows one run claims. */
/** 每次运行领取的到期行数。 */
export const REMINDER_CLAIM_BATCH = 60;
/** Class occurrences one scan returns. */
/** 每次扫描返回的上课次数。 */
export const CLASS_SCAN_LIMIT = 60;
/** Finished rows are kept this long, so the ledger stays small. */
/** 已结束的行保留这么久，记录表因此保持较小。 */
export const REMINDER_RETENTION_MS = 14 * 24 * 60 * MINUTE_MS;
/** Finished rows one retention pass deletes. */
/** 每次清理删除的已结束行数。 */
export const REMINDER_PRUNE_BATCH = 500;

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/** A row the run took for sending: due assignment rows, and class rows put back for a retry. */
/** 本次运行领取待发送的行：到期的作业提醒，以及放回重试的上课提醒。 */
export interface ClaimedReminder {
  id: number;
  memberId: string;
  kind: 'class' | 'assignment';
  meetingId: string | null;
  assignmentId: string | null;
  /** The class start or the due time, which is also when the row expires. */
  /** 上课开始时间或截止时间，也是这一行失效的时间。 */
  occursAt: string;
  offsetKey: string;
  attempts: number;
}

interface ClaimedReminderRow {
  id: number;
  member_id: string;
  kind: 'class' | 'assignment';
  meeting_id: string | null;
  assignment_id: string | null;
  occurs_at: string;
  offset_key: string;
  attempts: number;
}

/** What the housekeeping and claim batch did. */
/** 整理和领取批次的结果。 */
export interface DueClaim {
  rows: ClaimedReminder[];
  /** Rows a run that died left in sending: put back for another try, or failed. */
  /** 中断的运行留在发送中的行：放回再试，或记为失败。 */
  abandoned: number;
  /** Due rows cancelled because they would expire within a minute, which only a cron outage leaves. */
  /** 因一分钟内就要失效而取消的到期行，只有定时任务中断才会留下这样的行。 */
  expired: number;
}

/**
 * Housekeeping and the claim, in one batch: rows abandoned in sending go back to pending while attempts and time
 * remain (or fail), due rows that would expire within a minute are cancelled, then due rows are claimed in one
 * statement, so two overlapping runs never take the same row. `+status` keeps the outer update on rowid lookups.
 * 在一个批次中完成整理和领取：卡在发送中的行在仍有次数和时间时放回 pending（否则记为失败）；一分钟内就要失效的到期行改为取消；
 * 然后用一条语句领取到期的行，两次重叠的运行不会领到同一行。`+status` 让外层更新按 rowid 查找。
 */
export async function claimDueReminders(db: D1Database, runMs: number): Promise<DueClaim> {
  const t = iso(runMs);
  const soon = iso(runMs + REMINDER_EXPIRY_MARGIN_MS);
  const stuck = iso(runMs - REMINDER_STUCK_AFTER_MS);
  const results = await db.batch<ClaimedReminderRow>([
    db
      .prepare(
        `UPDATE timetable_reminders
         SET status = CASE WHEN attempts < ?1 AND expires_at > ?2 THEN 'pending' ELSE 'failed' END, claimed_at = NULL
         WHERE status = 'sending' AND (claimed_at IS NULL OR claimed_at < ?3)`,
      )
      .bind(REMINDER_ATTEMPTS_MAX, soon, stuck),
    db.prepare("UPDATE timetable_reminders SET status = 'cancelled' WHERE status = 'pending' AND send_at <= ?1 AND expires_at <= ?2").bind(t, soon),
    db
      .prepare(
        `UPDATE timetable_reminders SET status = 'sending', claimed_at = ?1, attempts = attempts + 1
         WHERE +status = 'pending' AND id IN (
           SELECT id FROM timetable_reminders WHERE status = 'pending' AND send_at <= ?1 AND expires_at > ?2 ORDER BY send_at LIMIT ?3
         )
         RETURNING id, member_id, kind, meeting_id, assignment_id, occurs_at, offset_key, attempts`,
      )
      .bind(t, soon, REMINDER_CLAIM_BATCH),
  ]);
  const rows: ClaimedReminder[] = (results[2]?.results ?? []).map((row) => ({
    id: row.id,
    memberId: row.member_id,
    kind: row.kind,
    meetingId: row.meeting_id,
    assignmentId: row.assignment_id,
    occursAt: row.occurs_at,
    offsetKey: row.offset_key,
    attempts: row.attempts,
  }));
  return { rows, abandoned: results[0]?.meta.changes ?? 0, expired: results[1]?.meta.changes ?? 0 };
}

/** A class the scan found: it takes place, every switch is on, and it has not been reminded. */
/** 扫描找到的一节课：这节课会上，所有开关都已开启，且尚未提醒。 */
export interface ScannedClass {
  meetingId: string;
  memberId: string;
  courseId: string;
  kind: MeetingKind;
  section: string | null;
  startMin: number;
  endMin: number;
  location: string | null;
  code: string;
  title: string | null;
  onDate: string;
  occursAt: string;
  lead: ClassLead;
  locale: TimetableLocale;
}

interface ScannedClassRow {
  meeting_id: string;
  member_id: string;
  course_id: string;
  kind: MeetingKind;
  section: string | null;
  start_min: number;
  end_min: number;
  location: string | null;
  code: string;
  title: string | null;
  on_date: string;
  occurs_at: string;
  lead_min: number;
  locale: TimetableLocale | null;
}

/** The term week of slot.on_date for the course's term t, the same number as the shared weekOfTerm. */
/** slot.on_date 在课程所属学期 t 中的周次，与共享的 weekOfTerm 相同。 */
const WEEK = "(CAST(julianday(slot.on_date) - julianday(date(t.starts_on, 'weekday 0', '-6 days')) AS INTEGER) / 7 + 1)";

/**
 * The class scan: every class starting at one of the slots whose member wants a reminder at that lead, with all of
 * occursOn's rules (term range, skipped weeks, odd, even and listed weeks, holidays and single skips) in the SQL,
 * and none already in the ledger. Each join and subquery is an index search (timetable_meetings_slot,
 * timetable_skips_key, timetable_reminders_class, push_devices_member).
 * 上课提醒扫描：找出在这些时刻开始、其成员希望以该提前时间提醒的每节课。occursOn 的全部规则（学期范围、停课周、单双周和自定义周次、
 * 假日和单次停课）都在 SQL 中计算，并排除已在提醒记录中的课。每个联表和子查询都走索引。
 */
export async function scanClassReminders(db: D1Database, slots: readonly ClassSlot[]): Promise<ScannedClass[]> {
  if (slots.length === 0) return [];
  const result = await db
    .prepare(
      `WITH slot (lead_min, weekday, start_min, on_date, occurs_at) AS (VALUES ${slots.map(() => '(?, ?, ?, ?, ?)').join(', ')})
       SELECT m.id AS meeting_id, m.member_id, m.course_id, m.kind, m.section, m.start_min, m.end_min, m.location,
              c.code, c.title, slot.on_date, slot.occurs_at, slot.lead_min, s.locale
       FROM slot
       JOIN timetable_meetings m ON m.weekday = slot.weekday AND m.start_min = slot.start_min
       JOIN timetable_settings s ON s.member_id = m.member_id AND s.class_reminders = 1 AND s.class_lead_min = slot.lead_min
       JOIN timetable_courses c ON c.id = m.course_id AND c.remind = 1
       LEFT JOIN timetable_terms t ON t.id = c.term_id
       JOIN members mem ON mem.id = m.member_id AND mem.status = 'active'
       LEFT JOIN notification_prefs p ON p.member_id = m.member_id
       WHERE IFNULL(p.timetable, 1) = 1
         AND EXISTS (SELECT 1 FROM push_devices d WHERE d.member_id = m.member_id)
         AND (c.term_id IS NULL OR (
               slot.on_date BETWEEN t.starts_on AND t.ends_on
               AND NOT EXISTS (SELECT 1 FROM json_each(t.skip_weeks) w WHERE w.value = ${WEEK})
               AND (m.week_rule = 'all'
                    OR (m.week_rule = 'odd' AND ${WEEK} % 2 = 1)
                    OR (m.week_rule = 'even' AND ${WEEK} % 2 = 0)
                    OR (m.week_rule = 'list' AND EXISTS (SELECT 1 FROM json_each(m.week_list) w WHERE w.value = ${WEEK})))))
         AND NOT EXISTS (SELECT 1 FROM timetable_skips k WHERE k.member_id = m.member_id AND k.on_date = slot.on_date
                         AND IFNULL(k.meeting_id, '') IN ('', m.id))
         AND NOT EXISTS (SELECT 1 FROM timetable_reminders r WHERE r.meeting_id = m.id AND r.occurs_at = slot.occurs_at)
       ORDER BY slot.occurs_at, m.member_id, m.id
       LIMIT ${CLASS_SCAN_LIMIT}`,
    )
    .bind(...slots.flatMap((slot) => [slot.lead, slot.weekday, slot.startMin, slot.onDate, slot.occursAt]))
    .all<ScannedClassRow>();
  return result.results.map((row) => ({
    meetingId: row.meeting_id,
    memberId: row.member_id,
    courseId: row.course_id,
    kind: row.kind,
    section: row.section,
    startMin: row.start_min,
    endMin: row.end_min,
    location: row.location,
    code: row.code,
    title: row.title,
    onDate: row.on_date,
    occursAt: row.occurs_at,
    lead: row.lead_min as ClassLead,
    locale: row.locale === 'en' ? 'en' : 'zh',
  }));
}

export interface ClassClaim {
  memberId: string;
  meetingId: string;
  occursAt: string;
  lead: ClassLead;
}

export interface ClaimedClass {
  id: number;
  meetingId: string;
  occursAt: string;
}

/**
 * Writes the ledger rows for scanned classes, already in sending with one attempt. A class another run claimed
 * first conflicts and comes back with nothing, so only the rows returned here are sent.
 * 为扫描到的课写入提醒记录，直接处于发送中且已计一次尝试。已被另一次运行先领取的课会冲突且不返回，所以只发送这里返回的行。
 */
export async function claimClassReminders(db: D1Database, claims: readonly ClassClaim[], runMs: number): Promise<ClaimedClass[]> {
  if (claims.length === 0) return [];
  const rows = claims.map((claim) => ({
    memberId: claim.memberId,
    meetingId: claim.meetingId,
    occursAt: claim.occursAt,
    lead: `${claim.lead}m`,
    sendAt: iso(Date.parse(claim.occursAt) - claim.lead * MINUTE_MS),
  }));
  const result = await db
    .prepare(
      `INSERT INTO timetable_reminders (member_id, kind, meeting_id, occurs_at, offset_key, send_at, expires_at, status, attempts, claimed_at, created_at)
       SELECT j.value ->> '$.memberId', 'class', j.value ->> '$.meetingId', j.value ->> '$.occursAt', j.value ->> '$.lead',
              j.value ->> '$.sendAt', j.value ->> '$.occursAt', 'sending', 1, ?1, ?1
       FROM json_each(?2) j WHERE true
       ON CONFLICT DO NOTHING
       RETURNING id, meeting_id, occurs_at`,
    )
    .bind(iso(runMs), JSON.stringify(rows))
    .all<{ id: number; meeting_id: string; occurs_at: string }>();
  return result.results.map((row) => ({ id: row.id, meetingId: row.meeting_id, occursAt: row.occurs_at }));
}

/** An assignment as a claimed row needs it, to check the row still holds. */
/** 检查已领取的作业提醒是否仍然有效所需的作业信息。 */
export interface AssignmentDetail {
  id: string;
  memberId: string;
  title: string;
  dueAt: string;
  done: boolean;
  remindOffsets: AssignmentOffset[];
  courseCode: string | null;
}

/** The meeting of a class row put back for a retry, with what decides whether the class still takes place. */
/** 放回重试的上课提醒所对应的上课时间，以及判断这节课是否仍然会上所需的信息。 */
export interface RetryMeetingDetail {
  reminderId: number;
  meetingId: string;
  memberId: string;
  kind: MeetingKind;
  weekday: Weekday;
  startMin: number;
  endMin: number;
  location: string | null;
  weekRule: WeekRule;
  weekList: number[] | null;
  code: string;
  remind: boolean;
  /** null: the course has no term. undefined: it names a term that no longer exists. */
  /** null：课程不属于学期。undefined：课程指向的学期已不存在。 */
  term: { startsOn: string; endsOn: string; skipWeeks: number[] } | null | undefined;
  /** A holiday or 本次不上 covers the class's date. */
  /** 这节课的日期有假日或「本次不上」。 */
  skipped: boolean;
}

export interface MemberTimetableSettings {
  locale: TimetableLocale;
  classReminders: boolean;
}

export interface ReminderDetails {
  assignments: Map<string, AssignmentDetail>;
  /** By reminder id. */
  /** 按提醒 id 索引。 */
  meetings: Map<number, RetryMeetingDetail>;
  /** Members without a settings row are missing: they have the defaults (zh, class reminders off). */
  /** 没有设置记录的成员不在其中：他们使用默认值（中文，上课提醒关闭）。 */
  settings: Map<string, MemberTimetableSettings>;
}

interface AssignmentDetailRow {
  id: string;
  member_id: string;
  title: string;
  due_at: string;
  done_at: string | null;
  remind_offsets: string;
  code: string | null;
}

interface RetryMeetingRow {
  reminder_id: number;
  meeting_id: string;
  member_id: string;
  kind: MeetingKind;
  weekday: number;
  start_min: number;
  end_min: number;
  location: string | null;
  week_rule: WeekRule;
  week_list: string | null;
  code: string;
  remind: number;
  term_id: string | null;
  term_found: string | null;
  starts_on: string | null;
  ends_on: string | null;
  skip_weeks: string | null;
  skipped: number;
}

interface SettingsRow {
  member_id: string;
  locale: string;
  class_reminders: number;
}

function jsonArray(raw: string | null | undefined): unknown[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function weekNumbers(raw: string | null | undefined): number[] {
  return jsonArray(raw).filter((value): value is number => typeof value === 'number' && Number.isInteger(value));
}

function offsetTokens(raw: string): AssignmentOffset[] {
  const known = new Set<string>(ASSIGNMENT_OFFSETS);
  return jsonArray(raw).filter((value): value is AssignmentOffset => typeof value === 'string' && known.has(value));
}

function toRetryMeeting(row: RetryMeetingRow): RetryMeetingDetail {
  const term =
    row.term_id === null
      ? null
      : row.term_found === null || row.starts_on === null || row.ends_on === null
        ? undefined
        : { startsOn: row.starts_on, endsOn: row.ends_on, skipWeeks: weekNumbers(row.skip_weeks) };
  return {
    reminderId: row.reminder_id,
    meetingId: row.meeting_id,
    memberId: row.member_id,
    kind: row.kind,
    weekday: row.weekday as Weekday,
    startMin: row.start_min,
    endMin: row.end_min,
    location: row.location,
    weekRule: row.week_rule,
    weekList: row.week_rule === 'list' ? weekNumbers(row.week_list) : null,
    code: row.code,
    remind: row.remind === 1,
    term,
    skipped: row.skipped === 1,
  };
}

/**
 * What checking the claimed rows needs, in one batch of at most three reads: the assignments with their course
 * codes, the meetings of retried class rows with their course, term and any skip on the class's date, and the
 * members' timetable settings.
 * 检查已领取的行所需的数据，在一个最多三次读取的批次中完成：作业及其课程代码；重试的上课提醒所对应的上课时间，连同课程、学期和当天的停课；
 * 以及成员的课表设置。
 */
export async function loadReminderDetails(
  db: D1Database,
  request: { assignmentIds: readonly string[]; classRows: readonly { id: number; meetingId: string; memberId: string; onDate: string }[]; memberIds: readonly string[] },
): Promise<ReminderDetails> {
  const details: ReminderDetails = { assignments: new Map(), meetings: new Map(), settings: new Map() };
  const reads: { kind: 'assignments' | 'meetings' | 'settings'; statement: D1PreparedStatement }[] = [];
  const assignmentIds = [...new Set(request.assignmentIds)];
  const memberIds = [...new Set(request.memberIds)];
  if (assignmentIds.length > 0) {
    reads.push({
      kind: 'assignments',
      statement: db
        .prepare(
          `SELECT a.id, a.member_id, a.title, a.due_at, a.done_at, a.remind_offsets, c.code
           FROM timetable_assignments a LEFT JOIN timetable_courses c ON c.id = a.course_id
           WHERE a.id IN (SELECT value FROM json_each(?1))`,
        )
        .bind(JSON.stringify(assignmentIds)),
    });
  }
  if (request.classRows.length > 0) {
    reads.push({
      kind: 'meetings',
      statement: db
        .prepare(
          `SELECT j.value ->> '$.id' AS reminder_id, m.id AS meeting_id, m.member_id, m.kind, m.weekday, m.start_min, m.end_min, m.location,
                  m.week_rule, m.week_list, c.code, c.remind, c.term_id, t.id AS term_found, t.starts_on, t.ends_on, t.skip_weeks,
                  EXISTS (SELECT 1 FROM timetable_skips k WHERE k.member_id = m.member_id AND k.on_date = j.value ->> '$.onDate'
                          AND IFNULL(k.meeting_id, '') IN ('', m.id)) AS skipped
           FROM json_each(?1) j
           JOIN timetable_meetings m ON m.id = j.value ->> '$.meetingId' AND m.member_id = j.value ->> '$.memberId'
           JOIN timetable_courses c ON c.id = m.course_id
           LEFT JOIN timetable_terms t ON t.id = c.term_id`,
        )
        .bind(JSON.stringify(request.classRows)),
    });
  }
  if (memberIds.length > 0) {
    reads.push({
      kind: 'settings',
      statement: db
        .prepare('SELECT member_id, locale, class_reminders FROM timetable_settings WHERE member_id IN (SELECT value FROM json_each(?1))')
        .bind(JSON.stringify(memberIds)),
    });
  }
  if (reads.length === 0) return details;
  const results = await db.batch(reads.map((read) => read.statement));
  reads.forEach((read, index) => {
    const rows = (results[index]?.results ?? []) as unknown[];
    if (read.kind === 'assignments') {
      for (const row of rows as AssignmentDetailRow[]) {
        details.assignments.set(row.id, {
          id: row.id,
          memberId: row.member_id,
          title: row.title,
          dueAt: row.due_at,
          done: row.done_at !== null,
          remindOffsets: offsetTokens(row.remind_offsets),
          courseCode: row.code,
        });
      }
    } else if (read.kind === 'meetings') {
      for (const row of rows as RetryMeetingRow[]) details.meetings.set(Number(row.reminder_id), toRetryMeeting(row));
    } else {
      for (const row of rows as SettingsRow[]) {
        details.settings.set(row.member_id, { locale: row.locale === 'en' ? 'en' : 'zh', classReminders: row.class_reminders === 1 });
      }
    }
  });
  return details;
}

/** How each claimed row ended. retry goes back to pending while attempts and time remain. */
/** 每个已领取的行的结果。retry 在仍有次数和时间时回到 pending。 */
export interface ReminderOutcomes {
  sent: readonly number[];
  skipped: readonly number[];
  failed: readonly number[];
  cancelled: readonly number[];
  retry: readonly number[];
}

const FINAL_STATUSES = ['skipped', 'failed', 'cancelled'] as const;

/**
 * Finishes claimed rows in one batch of at most five updates, one per outcome. Each only touches rows still in
 * sending, so a row deleted or requeued meanwhile is left as it is.
 * 用一个最多五条更新的批次结束已领取的行，每种结果一条。每条只更新仍在发送中的行，期间被删除或放回的行保持不变。
 */
export async function finishReminders(db: D1Database, outcomes: ReminderOutcomes, runMs: number, sentAtMs: number): Promise<void> {
  const ids = (list: readonly number[]) => JSON.stringify([...new Set(list)]);
  const statements: D1PreparedStatement[] = [];
  if (outcomes.sent.length > 0) {
    statements.push(
      db
        .prepare("UPDATE timetable_reminders SET status = 'sent', sent_at = ?1 WHERE id IN (SELECT value FROM json_each(?2)) AND +status = 'sending'")
        .bind(iso(sentAtMs), ids(outcomes.sent)),
    );
  }
  for (const status of FINAL_STATUSES) {
    const list = outcomes[status];
    if (list.length === 0) continue;
    statements.push(
      db
        .prepare("UPDATE timetable_reminders SET status = ?1 WHERE id IN (SELECT value FROM json_each(?2)) AND +status = 'sending'")
        .bind(status, ids(list)),
    );
  }
  if (outcomes.retry.length > 0) {
    statements.push(
      db
        .prepare(
          `UPDATE timetable_reminders
           SET status = CASE WHEN attempts < ?1 AND expires_at > ?2 THEN 'pending' ELSE 'failed' END, claimed_at = NULL
           WHERE id IN (SELECT value FROM json_each(?3)) AND +status = 'sending'`,
        )
        .bind(REMINDER_ATTEMPTS_MAX, iso(runMs + REMINDER_EXPIRY_MARGIN_MS), ids(outcomes.retry)),
    );
  }
  if (statements.length > 0) await db.batch(statements);
}

/** Deletes finished rows sent more than 14 days ago, at most REMINDER_PRUNE_BATCH at a time. Returns how many. */
/** 删除 14 天前发送且已结束的行，每次最多 REMINDER_PRUNE_BATCH 行。返回删除的行数。 */
export async function pruneReminders(db: D1Database, runMs: number): Promise<number> {
  const result = await db
    .prepare(
      `DELETE FROM timetable_reminders WHERE id IN (
         SELECT id FROM timetable_reminders WHERE status IN ('sent', 'skipped', 'cancelled', 'failed') AND send_at < ?1 LIMIT ?2
       )`,
    )
    .bind(iso(runMs - REMINDER_RETENTION_MS), REMINDER_PRUNE_BATCH)
    .run();
  return result.meta.changes ?? 0;
}
