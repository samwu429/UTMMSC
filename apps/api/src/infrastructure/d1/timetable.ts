import {
  ASSIGNMENT_OFFSETS,
  CLASS_LEADS,
  COURSE_COLORS,
  DEFAULT_TIMETABLE_SETTINGS,
  MEETING_KINDS,
  skipKey,
  WEEK_RULES,
  type AssignmentOffset,
  type ClassLead,
  type CourseColor,
  type ImportTimetableBody,
  type MeetingKind,
  type PlannedAssignmentReminder,
  type SaveAssignmentBody,
  type SaveCourseBody,
  type SaveTermBody,
  type TimetableAssignment,
  type TimetableCourse,
  type TimetableMeeting,
  type TimetableSettings,
  type TimetableSkip,
  type TimetableTerm,
  type UpdateTimetableSettingsBody,
  type Weekday,
  type WeekRule,
} from '@utmmsc/shared';
import { emptyTimetableFacts, type TimetableCounts, type TimetableFacts } from '../../domain/timetable/input';

/**
 * The personal timetable in D1 (migration 0017). Every statement binds the session's member id, every upsert is
 * guarded so another member's row is never overwritten, and every write batch ends with the rev bump, so
 * GET ?rev= can answer "unchanged" from one row. Bulk rows go through json_each, one statement whatever the
 * count, which keeps each request far under D1's 100-parameter and 50-query limits. The routes check bodies
 * with the shared readers and the facts read here before they write.
 * D1 中的个人课表（迁移 0017）。每条语句都绑定会话成员的 id，每个 upsert 都有所有者保护，不会覆盖另一位成员的行；
 * 每个写入批次都以 rev 加一结束，GET ?rev= 因此只读一行就能回答「没有变化」。批量的行通过 json_each 写入，不论多少行都只用一条语句，
 * 每个请求都远低于 D1 的 100 个参数和 50 条查询的上限。接口在写入之前用共享的读取函数检查请求体，并用这里读出的事实做检查。
 */

const DAY_MS = 86_400_000;
/** Done assignments stay in GET this long, for 已完成 and its 清除已完成. */
/** 已完成的作业在 GET 中保留这么久，用于「已完成」和「清除已完成」。 */
export const DONE_ASSIGNMENT_KEEP_MS = 30 * DAY_MS;
/**
 * Rows per json_each statement in an import. A thousand assignments with long notes would pass D1's 2 MB value
 * limit in one parameter, so they go in slices.
 * 导入时每条 json_each 语句的行数。一千项带长备注的作业放在一个参数里会超过 D1 单个值 2 MB 的上限，因此分批写入。
 */
const IMPORT_SLICE = 250;

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function slices<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < items.length; start += size) out.push(items.slice(start, start + size));
  return out;
}

/* Rows */

interface SettingsRow {
  rev: number | null;
  class_reminders: number | null;
  class_lead_min: number | null;
  assignment_offsets: string | null;
  show_weekend: string | null;
  locale: string | null;
}

interface TermRow {
  id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  skip_weeks: string;
  updated_at: string;
}

interface CourseRow {
  id: string;
  term_id: string | null;
  code: string;
  title: string | null;
  color: string;
  notes: string | null;
  remind: number;
  updated_at: string;
}

interface MeetingRow {
  id: string;
  course_id: string;
  kind: string;
  section: string | null;
  weekday: number;
  start_min: number;
  end_min: number;
  location: string | null;
  week_rule: string;
  week_list: string | null;
}

interface SkipRow {
  on_date: string;
  meeting_id: string | null;
  label: string | null;
}

interface AssignmentRow {
  id: string;
  course_id: string | null;
  title: string;
  notes: string | null;
  due_at: string;
  remind_offsets: string;
  done_at: string | null;
  updated_at: string;
}

function parseJson(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** Whole weeks from a stored JSON array, ascending; anything else in it is dropped. */
/** 从已存的 JSON 数组读出的整数周次，升序；其中的其他内容被丢弃。 */
function weekList(text: string | null): number[] {
  const value = parseJson(text);
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((week): week is number => typeof week === 'number' && Number.isInteger(week)))].sort((a, b) => a - b);
}

/** Offsets from a stored JSON array, in the order of ASSIGNMENT_OFFSETS. */
/** 从已存的 JSON 数组读出的提醒时间，按 ASSIGNMENT_OFFSETS 的顺序排列。 */
function offsetList(text: string | null): AssignmentOffset[] {
  const value = parseJson(text);
  const stored = new Set(Array.isArray(value) ? value : []);
  return ASSIGNMENT_OFFSETS.filter((token) => stored.has(token));
}

function oneOf<T extends string | number>(value: unknown, options: readonly T[], fallback: T): T {
  return (options as readonly unknown[]).includes(value) ? (value as T) : fallback;
}

function toSettings(row: SettingsRow | null): TimetableSettings {
  if (!row || row.rev === null) return { ...DEFAULT_TIMETABLE_SETTINGS, assignmentOffsets: [...DEFAULT_TIMETABLE_SETTINGS.assignmentOffsets] };
  return {
    classReminders: row.class_reminders === 1,
    classLeadMin: oneOf<ClassLead>(row.class_lead_min, CLASS_LEADS, DEFAULT_TIMETABLE_SETTINGS.classLeadMin),
    assignmentOffsets: offsetList(row.assignment_offsets),
    showWeekend: row.show_weekend === 'auto' ? 'auto' : 'always',
    locale: row.locale === 'en' ? 'en' : 'zh',
  };
}

function toTerm(row: TermRow): TimetableTerm {
  return { id: row.id, name: row.name, startsOn: row.starts_on, endsOn: row.ends_on, skipWeeks: weekList(row.skip_weeks), updatedAt: row.updated_at };
}

function toMeeting(row: MeetingRow): TimetableMeeting {
  const weekRule = oneOf<WeekRule>(row.week_rule, WEEK_RULES, 'all');
  return {
    id: row.id,
    kind: oneOf<MeetingKind>(row.kind, MEETING_KINDS, 'other'),
    section: row.section,
    weekday: row.weekday as Weekday,
    startMin: row.start_min,
    endMin: row.end_min,
    location: row.location,
    weekRule,
    weekList: weekRule === 'list' ? weekList(row.week_list) : null,
  };
}

function toCourse(row: CourseRow, meetings: TimetableMeeting[]): TimetableCourse {
  return {
    id: row.id,
    termId: row.term_id,
    code: row.code,
    title: row.title,
    color: oneOf<CourseColor>(row.color, COURSE_COLORS, COURSE_COLORS[0]),
    notes: row.notes,
    remind: row.remind === 1,
    meetings,
    updatedAt: row.updated_at,
  };
}

function toSkip(row: SkipRow): TimetableSkip {
  return { onDate: row.on_date, meetingId: row.meeting_id, label: row.label };
}

function toAssignment(row: AssignmentRow): TimetableAssignment {
  return {
    id: row.id,
    courseId: row.course_id,
    title: row.title,
    notes: row.notes,
    dueAt: row.due_at,
    remindOffsets: offsetList(row.remind_offsets),
    doneAt: row.done_at,
    updatedAt: row.updated_at,
  };
}

/** The order GET lists a course's meetings in: weekday, start, then id. */
/** GET 中课程上课时间的顺序：星期、开始时间，然后是 id。 */
function byMeetingSlot(a: TimetableMeeting, b: TimetableMeeting): number {
  return a.weekday - b.weekday || a.startMin - b.startMin || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/* Reads */

export interface TimetableHead {
  /** 0 for a member who never wrote anything. */
  /** 从未写入过任何内容的成员为 0。 */
  rev: number;
  /** 设置 → 通知 → 课表提醒; a missing prefs row means on. */
  /** 「设置 → 通知 → 课表提醒」；没有通知设置记录表示开启。 */
  remindersAllowed: boolean;
  settings: TimetableSettings;
}

/**
 * The first query of GET: the member's settings row, which may be missing, and the 课表提醒 switch, in one
 * statement that always returns one row.
 * GET 的第一条查询：成员的设置记录（可能不存在）以及「课表提醒」开关，一条语句，总是返回一行。
 */
export async function readTimetableHead(db: D1Database, memberId: string): Promise<TimetableHead> {
  const row = await db
    .prepare(
      `SELECT s.rev, s.class_reminders, s.class_lead_min, s.assignment_offsets, s.show_weekend, s.locale, IFNULL(p.timetable, 1) AS reminders_allowed
       FROM (SELECT ? AS id) me
       LEFT JOIN timetable_settings s ON s.member_id = me.id
       LEFT JOIN notification_prefs p ON p.member_id = me.id`,
    )
    .bind(memberId)
    .first<SettingsRow & { reminders_allowed: number }>();
  return { rev: row?.rev ?? 0, remindersAllowed: (row?.reminders_allowed ?? 1) !== 0, settings: toSettings(row) };
}

export interface TimetableContent {
  terms: TimetableTerm[];
  courses: TimetableCourse[];
  skips: TimetableSkip[];
  assignments: TimetableAssignment[];
}

/**
 * Everything GET returns besides the head, in one batch of five SELECTs: terms, courses, meetings by weekday and
 * start, skips, and open assignments plus those done in the last 30 days, by due time.
 * GET 除第一条查询以外返回的全部内容，一个批次中的五条 SELECT：学期、课程、按星期和开始时间排列的上课时间、停课记录，
 * 以及未完成和最近 30 天内完成的作业（按截止时间排列）。
 */
export async function loadTimetable(db: D1Database, memberId: string, nowMs: number): Promise<TimetableContent> {
  const [terms, courses, meetings, skips, assignments] = await db.batch([
    db.prepare('SELECT id, name, starts_on, ends_on, skip_weeks, updated_at FROM timetable_terms WHERE member_id = ? ORDER BY starts_on, id').bind(memberId),
    db.prepare('SELECT id, term_id, code, title, color, notes, remind, updated_at FROM timetable_courses WHERE member_id = ? ORDER BY created_at, id').bind(memberId),
    db
      .prepare(
        'SELECT id, course_id, kind, section, weekday, start_min, end_min, location, week_rule, week_list FROM timetable_meetings WHERE member_id = ? ORDER BY weekday, start_min, id',
      )
      .bind(memberId),
    db.prepare("SELECT on_date, meeting_id, label FROM timetable_skips WHERE member_id = ? ORDER BY on_date, IFNULL(meeting_id, '')").bind(memberId),
    db
      .prepare(
        `SELECT id, course_id, title, notes, due_at, remind_offsets, done_at, updated_at FROM timetable_assignments
         WHERE member_id = ? AND (done_at IS NULL OR done_at > ?) ORDER BY due_at, id`,
      )
      .bind(memberId, iso(nowMs - DONE_ASSIGNMENT_KEEP_MS)),
  ]);
  const byCourse = new Map<string, TimetableMeeting[]>();
  for (const row of (meetings?.results ?? []) as unknown as MeetingRow[]) {
    const list = byCourse.get(row.course_id) ?? [];
    list.push(toMeeting(row));
    byCourse.set(row.course_id, list);
  }
  return {
    terms: ((terms?.results ?? []) as unknown as TermRow[]).map(toTerm),
    courses: ((courses?.results ?? []) as unknown as CourseRow[]).map((row) => toCourse(row, byCourse.get(row.id) ?? [])),
    skips: ((skips?.results ?? []) as unknown as SkipRow[]).map(toSkip),
    assignments: ((assignments?.results ?? []) as unknown as AssignmentRow[]).map(toAssignment),
  };
}

/** The ids and counts a write's pre-check needs; leaving a list out skips that part of the query. */
/** 写入预检查所需的 id 和数量；省略某个列表即跳过查询中的那一部分。 */
export interface TimetableFactsRequest {
  termIds?: readonly string[];
  courseIds?: readonly string[];
  meetingIds?: readonly string[];
  assignmentIds?: readonly string[];
  skips?: readonly Pick<TimetableSkip, 'onDate' | 'meetingId'>[];
  counts?: readonly (keyof TimetableCounts)[];
  /** When the 30-day window of the assignments count ends; Date.now() when left out. */
  /** assignments 数量的 30 天窗口截止的时刻；省略时为 Date.now()。 */
  nowMs?: number;
}

/**
 * Each count's statement; ?1 is the member. `keptSince` binds the oldest done_at GET still returns and gives its
 * placeholder, so assignments counts exactly the rows loadTimetable lists.
 * 每个数量的查询语句；?1 为成员。`keptSince` 绑定 GET 仍会返回的最早 done_at 并给出其占位符，因此 assignments 统计的正是
 * loadTimetable 列出的那些行。
 */
const COUNT_SQL: Record<keyof TimetableCounts, (keptSince: () => string) => string> = {
  terms: () => 'SELECT COUNT(*) FROM timetable_terms WHERE member_id = ?1',
  courses: () => 'SELECT COUNT(*) FROM timetable_courses WHERE member_id = ?1',
  openAssignments: () => 'SELECT COUNT(*) FROM timetable_assignments WHERE member_id = ?1 AND done_at IS NULL',
  assignments: (keptSince) => `SELECT COUNT(*) FROM timetable_assignments WHERE member_id = ?1 AND (done_at IS NULL OR done_at > ${keptSince()})`,
  skips: () => 'SELECT COUNT(*) FROM timetable_skips WHERE member_id = ?1',
};

interface FactRow {
  kind: string;
  id: string | null;
  owner: string | null;
  parent: string | null;
  n: number | null;
}

/**
 * The pre-check of a write in one round trip of at most two statements. The first is a UNION ALL of the owner of
 * every named id (whoever it is), the course of every named meeting and which named skips the member already has:
 * at most five terms, D1's limit for a compound SELECT. The second is one row with every count asked for. The member
 * is ?1 in both. Nothing here is ever sent back.
 * 一次往返、最多两条语句完成写入的预检查。第一条用 UNION ALL 合并所涉每个 id 的所有者（不论是谁）、所涉每个上课时间所属的课程，以及
 * 成员已有的所涉停课记录：最多五项，正是 D1 对复合 SELECT 的上限。第二条是一行，包含所需的全部数量。两条语句中成员都是 ?1。
 * 这里的内容从不返回给客户端。
 */
export async function readTimetableFacts(db: D1Database, memberId: string, request: TimetableFactsRequest): Promise<TimetableFacts> {
  const params: unknown[] = [memberId];
  const bind = (value: unknown): string => {
    params.push(value);
    return `?${params.length}`;
  };
  const json = (value: unknown): string => `json_each(${bind(JSON.stringify(value))})`;
  const countParams: unknown[] = [memberId];
  const keptSince = () => {
    countParams.push(iso((request.nowMs ?? Date.now()) - DONE_ASSIGNMENT_KEEP_MS));
    return `?${countParams.length}`;
  };
  const parts: string[] = [];
  const owners = (kind: string, table: string, ids: readonly string[] | undefined, parent = 'NULL') => {
    if (ids && ids.length > 0) {
      parts.push(`SELECT '${kind}' AS kind, id, member_id AS owner, ${parent} AS parent, NULL AS n FROM ${table} WHERE id IN (SELECT value FROM ${json(ids)})`);
    }
  };
  owners('term', 'timetable_terms', request.termIds);
  owners('course', 'timetable_courses', request.courseIds);
  owners('meeting', 'timetable_meetings', request.meetingIds, 'course_id');
  owners('assignment', 'timetable_assignments', request.assignmentIds, 'done_at');
  if (request.skips && request.skips.length > 0) {
    const named = json(request.skips.map((skip) => ({ onDate: skip.onDate, meetingId: skip.meetingId })));
    parts.push(
      `SELECT 'skip' AS kind, k.on_date AS id, k.member_id AS owner, k.meeting_id AS parent, NULL AS n FROM ${named} j
       JOIN timetable_skips k ON k.member_id = ?1 AND k.on_date = j.value ->> '$.onDate' AND IFNULL(k.meeting_id, '') = IFNULL(j.value ->> '$.meetingId', '')`,
    );
  }
  const counts = [...new Set(request.counts ?? [])];
  const facts = emptyTimetableFacts();
  const statements: D1PreparedStatement[] = [];
  if (parts.length > 0) statements.push(db.prepare(parts.join('\nUNION ALL\n')).bind(...params));
  if (counts.length > 0) {
    statements.push(db.prepare(`SELECT ${counts.map((count) => `(${COUNT_SQL[count](keptSince)}) AS "${count}"`).join(', ')}`).bind(...countParams));
  }
  if (statements.length === 0) return facts;
  const answers = await db.batch<Record<string, unknown>>(statements);
  const results = (parts.length > 0 ? (answers[0]?.results ?? []) : []) as unknown as FactRow[];
  const countRow = counts.length > 0 ? answers[answers.length - 1]?.results[0] : undefined;
  for (const count of counts) facts.counts[count] = Number(countRow?.[count] ?? 0);
  const terms = facts.terms as Map<string, string>;
  const courses = facts.courses as Map<string, string>;
  const meetings = facts.meetings as Map<string, { memberId: string; courseId: string }>;
  const assignments = facts.assignments as Map<string, { memberId: string; doneAt: string | null }>;
  const skips = facts.skips as Set<string>;
  for (const row of results) {
    const id = row.id ?? '';
    const owner = row.owner ?? '';
    if (row.kind === 'term') terms.set(id, owner);
    else if (row.kind === 'course') courses.set(id, owner);
    else if (row.kind === 'meeting') meetings.set(id, { memberId: owner, courseId: row.parent ?? '' });
    else if (row.kind === 'assignment') assignments.set(id, { memberId: owner, doneAt: row.parent });
    else if (row.kind === 'skip') skips.add(skipKey(id, row.parent));
  }
  return facts;
}

/** One of the member's assignments, with how many of theirs are open, for PATCH /assignments/:id. */
/** 成员的一项作业，以及其未完成作业的数量，用于 PATCH /assignments/:id。 */
export async function findTimetableAssignment(db: D1Database, memberId: string, id: string): Promise<{ assignment: TimetableAssignment; openAssignments: number } | null> {
  const row = await db
    .prepare(
      `SELECT a.id, a.course_id, a.title, a.notes, a.due_at, a.remind_offsets, a.done_at, a.updated_at,
         (SELECT COUNT(*) FROM timetable_assignments o WHERE o.member_id = ?2 AND o.done_at IS NULL) AS open_assignments
       FROM timetable_assignments a WHERE a.id = ?1 AND a.member_id = ?2`,
    )
    .bind(id, memberId)
    .first<AssignmentRow & { open_assignments: number }>();
  return row ? { assignment: toAssignment(row), openAssignments: Number(row.open_assignments) } : null;
}

/* Writes */

/**
 * The last statement of every write batch: the member's rev goes up by one, creating the settings row with its
 * defaults on the first write.
 * 每个写入批次的最后一条语句：成员的 rev 加一；第一次写入时以默认值创建设置记录。
 */
function revBump(db: D1Database, memberId: string, now: string): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO timetable_settings (member_id, rev, updated_at) VALUES (?, 1, ?)
       ON CONFLICT (member_id) DO UPDATE SET rev = rev + 1, updated_at = excluded.updated_at RETURNING rev`,
    )
    .bind(memberId, now);
}

function revOf(results: readonly D1Result[]): number {
  const rev = (results[results.length - 1]?.results[0] as { rev?: unknown } | undefined)?.rev;
  if (typeof rev !== 'number') throw new Error('timetable rev bump returned no rev');
  return rev;
}

async function runWrite(db: D1Database, memberId: string, now: string, statements: D1PreparedStatement[]): Promise<{ rev: number; results: D1Result[] }> {
  const results = await db.batch([...statements, revBump(db, memberId, now)]);
  return { rev: revOf(results), results };
}

export interface TimetableWrite<T> {
  rev: number;
  item: T;
}

function meetingJson(meeting: TimetableMeeting, courseId?: string): Record<string, unknown> {
  return {
    id: meeting.id,
    ...(courseId === undefined ? {} : { courseId }),
    kind: meeting.kind,
    section: meeting.section,
    weekday: meeting.weekday,
    startMin: meeting.startMin,
    endMin: meeting.endMin,
    location: meeting.location,
    weekRule: meeting.weekRule,
    weekList: meeting.weekList,
  };
}

const MEETING_UPDATE = `ON CONFLICT (id) DO UPDATE SET kind = excluded.kind, section = excluded.section, weekday = excluded.weekday,
  start_min = excluded.start_min, end_min = excluded.end_min, location = excluded.location, week_rule = excluded.week_rule,
  week_list = excluded.week_list, updated_at = excluded.updated_at
WHERE timetable_meetings.member_id = excluded.member_id AND timetable_meetings.course_id = excluded.course_id`;

const COURSE_UPDATE = `ON CONFLICT (id) DO UPDATE SET term_id = excluded.term_id, code = excluded.code, title = excluded.title, color = excluded.color,
  notes = excluded.notes, remind = excluded.remind, updated_at = excluded.updated_at
WHERE timetable_courses.member_id = excluded.member_id`;

const TERM_UPDATE = `ON CONFLICT (id) DO UPDATE SET name = excluded.name, starts_on = excluded.starts_on, ends_on = excluded.ends_on,
  skip_weeks = excluded.skip_weeks, updated_at = excluded.updated_at
WHERE timetable_terms.member_id = excluded.member_id`;

const ASSIGNMENT_UPDATE = `ON CONFLICT (id) DO UPDATE SET course_id = excluded.course_id, title = excluded.title, notes = excluded.notes,
  due_at = excluded.due_at, remind_offsets = excluded.remind_offsets, done_at = excluded.done_at, updated_at = excluded.updated_at
WHERE timetable_assignments.member_id = excluded.member_id`;

/**
 * An assignment's course_id as written: the course when it is the member's, otherwise NULL. The pre-check has
 * already refused a course that is not theirs, so NULL only comes from a course deleted in between (by another
 * device), and the assignment then ends as that delete would have left it, instead of failing on the foreign key.
 * 写入时作业的 course_id：课程属于该成员时为该课程，否则为 NULL。预检查已经拒绝了不属于成员的课程，所以只有课程在两者之间
 * 被（另一台设备）删除时才会得到 NULL；此时作业的结果与该删除留下的一样，而不会因外键而失败。
 */
function ownCourseSql(courseId: string, memberId: string): string {
  return `(SELECT c.id FROM timetable_courses c WHERE c.id = ${courseId} AND c.member_id = ${memberId})`;
}

/**
 * Pending reminders of assignments in one json_each statement, ?1 the member, ?2 now, ?3 the plans. A row whose
 * assignment is not the member's is skipped, and an offset already in the ledger for the same due time, sent
 * or not, is never written twice.
 * 一条 json_each 语句写入作业的待发提醒，?1 为成员，?2 为现在，?3 为提醒安排。作业不属于该成员的行被跳过；
 * 同一截止时间、同一提醒时间已在提醒记录中的（无论是否已发送）不会重复写入。
 */
const PLAN_INSERT = `INSERT INTO timetable_reminders (member_id, kind, assignment_id, occurs_at, offset_key, send_at, expires_at, created_at)
SELECT ?1, 'assignment', j.value ->> '$.assignmentId', j.value ->> '$.dueAt', j.value ->> '$.offset', j.value ->> '$.sendAt', j.value ->> '$.dueAt', ?2
FROM json_each(?3) j
WHERE EXISTS (SELECT 1 FROM timetable_assignments a WHERE a.id = j.value ->> '$.assignmentId' AND a.member_id = ?1)
ON CONFLICT DO NOTHING`;

interface PlanRow {
  assignmentId: string;
  dueAt: string;
  offset: AssignmentOffset;
  sendAt: string;
}

function planRows(assignmentId: string, dueAt: string, plan: readonly PlannedAssignmentReminder[]): PlanRow[] {
  return plan.map((reminder) => ({ assignmentId, dueAt, offset: reminder.offset, sendAt: reminder.sendAt }));
}

/**
 * POST /courses after its pre-check: (1) the guarded course upsert, (2) delete the course's meetings the body no
 * longer lists, (3) every meeting in one json_each upsert, which keeps ids and created_at, so sent reminders and
 * single skips survive an edit, (4) the rev bump. A meeting row is written only while the course is the member's,
 * and an existing meeting only while it is theirs on this course.
 * 预检查通过后的 POST /courses：(1) 带所有者保护的课程 upsert，(2) 删除请求体中不再列出的上课时间，(3) 用一条 json_each upsert 写入
 * 全部上课时间，保留 id 和 created_at，已发出的提醒和单次停课在修改后仍然有效，(4) rev 加一。只有课程属于该成员时才写入上课时间；
 * 已有的上课时间只有属于该成员且在这门课程下时才更新。
 */
export async function writeTimetableCourse(db: D1Database, memberId: string, course: SaveCourseBody, nowMs: number): Promise<TimetableWrite<TimetableCourse>> {
  const now = iso(nowMs);
  const statements = [
    db
      .prepare(
        `INSERT INTO timetable_courses (id, member_id, term_id, code, title, color, notes, remind, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
         ${COURSE_UPDATE}`,
      )
      .bind(course.id, memberId, course.termId, course.code, course.title, course.color, course.notes, course.remind ? 1 : 0, now),
    db
      .prepare('DELETE FROM timetable_meetings WHERE course_id = ?1 AND member_id = ?2 AND id NOT IN (SELECT value FROM json_each(?3))')
      .bind(course.id, memberId, JSON.stringify(course.meetings.map((meeting) => meeting.id))),
  ];
  if (course.meetings.length > 0) {
    statements.push(
      db
        .prepare(
          `INSERT INTO timetable_meetings (id, course_id, member_id, kind, section, weekday, start_min, end_min, location, week_rule, week_list, created_at, updated_at)
           SELECT j.value ->> '$.id', ?1, ?2, j.value ->> '$.kind', j.value ->> '$.section', j.value ->> '$.weekday', j.value ->> '$.startMin',
                  j.value ->> '$.endMin', j.value ->> '$.location', j.value ->> '$.weekRule', j.value ->> '$.weekList', ?3, ?3
           FROM json_each(?4) j
           WHERE EXISTS (SELECT 1 FROM timetable_courses c WHERE c.id = ?1 AND c.member_id = ?2)
           ${MEETING_UPDATE}`,
        )
        .bind(course.id, memberId, now, JSON.stringify(course.meetings.map((meeting) => meetingJson(meeting)))),
    );
  }
  const { rev } = await runWrite(db, memberId, now, statements);
  return { rev, item: { ...course, meetings: [...course.meetings].sort(byMeetingSlot), updatedAt: now } };
}

/**
 * DELETE /courses/:id, idempotent for the outbox: an id that is gone or not the member's changes nothing but
 * still answers with the new rev. Meetings, single skips and class reminders cascade; assignments keep
 * course_id NULL.
 * DELETE /courses/:id，对发送队列幂等：已不存在或不属于该成员的 id 不会改变任何内容，但仍返回新的 rev。上课时间、单次停课和
 * 上课提醒级联删除；作业保留，course_id 变为 NULL。
 */
export async function deleteTimetableCourse(db: D1Database, memberId: string, id: string, nowMs: number): Promise<number> {
  const now = iso(nowMs);
  const { rev } = await runWrite(db, memberId, now, [db.prepare('DELETE FROM timetable_courses WHERE id = ? AND member_id = ?').bind(id, memberId)]);
  return rev;
}

/** POST /terms after its pre-check: the guarded upsert and the rev bump. */
/** 预检查通过后的 POST /terms：带所有者保护的 upsert 和 rev 加一。 */
export async function writeTimetableTerm(db: D1Database, memberId: string, term: SaveTermBody, nowMs: number): Promise<TimetableWrite<TimetableTerm>> {
  const now = iso(nowMs);
  const { rev } = await runWrite(db, memberId, now, [
    db
      .prepare(
        `INSERT INTO timetable_terms (id, member_id, name, starts_on, ends_on, skip_weeks, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
         ${TERM_UPDATE}`,
      )
      .bind(term.id, memberId, term.name, term.startsOn, term.endsOn, JSON.stringify(term.skipWeeks), now),
  ]);
  return { rev, item: { ...term, updatedAt: now } };
}

/** DELETE /terms/:id, idempotent; the term's courses cascade with everything under them. */
/** DELETE /terms/:id，幂等；该学期的课程及其下的一切级联删除。 */
export async function deleteTimetableTerm(db: D1Database, memberId: string, id: string, nowMs: number): Promise<number> {
  const now = iso(nowMs);
  const { rev } = await runWrite(db, memberId, now, [db.prepare('DELETE FROM timetable_terms WHERE id = ? AND member_id = ?').bind(id, memberId)]);
  return rev;
}

/**
 * POST /assignments and PATCH /assignments/:id after the pre-check: the guarded upsert with the done_at the route
 * worked out; the assignment's pending reminders deleted (+status keeps the planner on the assignment index);
 * the plan inserted, where an offset already sent for the same due time is skipped by the unique index; and the
 * rev bump. A done assignment gets no plan, so ticking it off cancels what was still pending.
 * 预检查通过后的 POST /assignments 与 PATCH /assignments/:id：使用接口算出的 done_at 进行带所有者保护的 upsert；删除该作业的待发提醒
 * （+status 让查询计划使用作业索引）；写入提醒安排，同一截止时间已发送过的提醒时间由唯一索引跳过；最后 rev 加一。已完成的作业没有提醒安排，
 * 因此勾选完成会取消尚未发送的提醒。
 */
export async function writeTimetableAssignment(
  db: D1Database,
  memberId: string,
  assignment: Omit<SaveAssignmentBody, 'done'>,
  doneAt: string | null,
  plan: readonly PlannedAssignmentReminder[],
  nowMs: number,
): Promise<TimetableWrite<TimetableAssignment>> {
  const now = iso(nowMs);
  const statements = [
    db
      .prepare(
        `INSERT INTO timetable_assignments (id, member_id, course_id, title, notes, due_at, remind_offsets, done_at, created_at, updated_at)
         VALUES (?1, ?2, ${ownCourseSql('?3', '?2')}, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
         ${ASSIGNMENT_UPDATE}`,
      )
      .bind(assignment.id, memberId, assignment.courseId, assignment.title, assignment.notes, assignment.dueAt, JSON.stringify(assignment.remindOffsets), doneAt, now),
    db.prepare("DELETE FROM timetable_reminders WHERE assignment_id = ?1 AND member_id = ?2 AND +status = 'pending'").bind(assignment.id, memberId),
  ];
  if (plan.length > 0) statements.push(db.prepare(PLAN_INSERT).bind(memberId, now, JSON.stringify(planRows(assignment.id, assignment.dueAt, plan))));
  const { rev } = await runWrite(db, memberId, now, statements);
  return {
    rev,
    item: {
      id: assignment.id,
      courseId: assignment.courseId,
      title: assignment.title,
      notes: assignment.notes,
      dueAt: assignment.dueAt,
      remindOffsets: [...assignment.remindOffsets],
      doneAt,
      updatedAt: now,
    },
  };
}

/** DELETE /assignments/:id, idempotent; its reminder rows cascade. */
/** DELETE /assignments/:id，幂等；其提醒记录级联删除。 */
export async function deleteTimetableAssignment(db: D1Database, memberId: string, id: string, nowMs: number): Promise<number> {
  const now = iso(nowMs);
  const { rev } = await runWrite(db, memberId, now, [db.prepare('DELETE FROM timetable_assignments WHERE id = ? AND member_id = ?').bind(id, memberId)]);
  return rev;
}

/**
 * POST /skips with skipped true: a holiday (meetingId null) or one 本次不上. Saving the same date again changes
 * nothing but the label, and only when the body named one. The row is written only while the meeting is the
 * member's; item is null when it was not, which the route answers as course_not_found.
 * POST /skips 且 skipped 为 true：假日（meetingId 为 null）或一次「本次不上」。再次保存同一日期只会修改名称，且只在请求体带有名称时修改。
 * 只有上课时间属于该成员时才写入；否则 item 为 null，接口回答 course_not_found。
 */
export async function writeTimetableSkip(
  db: D1Database,
  memberId: string,
  skip: TimetableSkip,
  labelGiven: boolean,
  nowMs: number,
): Promise<TimetableWrite<TimetableSkip | null>> {
  const now = iso(nowMs);
  const { rev, results } = await runWrite(db, memberId, now, [
    db
      .prepare(
        `INSERT INTO timetable_skips (member_id, on_date, meeting_id, label, created_at)
         SELECT ?1, ?2, ?3, ?4, ?5
         WHERE ?3 IS NULL OR EXISTS (SELECT 1 FROM timetable_meetings m WHERE m.id = ?3 AND m.member_id = ?1)
         ON CONFLICT (member_id, on_date, IFNULL(meeting_id, '')) DO UPDATE SET label = CASE WHEN ?6 = 1 THEN excluded.label ELSE timetable_skips.label END
         RETURNING on_date, meeting_id, label`,
      )
      .bind(memberId, skip.onDate, skip.meetingId, skip.label, now, labelGiven ? 1 : 0),
  ]);
  const row = results[0]?.results[0] as SkipRow | undefined;
  return { rev, item: row ? toSkip(row) : null };
}

/** POST /skips with skipped false: 恢复上课 or a holiday removed, idempotent. */
/** POST /skips 且 skipped 为 false：恢复上课或删除假日，幂等。 */
export async function deleteTimetableSkip(db: D1Database, memberId: string, skip: Pick<TimetableSkip, 'onDate' | 'meetingId'>, nowMs: number): Promise<number> {
  const now = iso(nowMs);
  const { rev } = await runWrite(db, memberId, now, [
    db.prepare("DELETE FROM timetable_skips WHERE member_id = ? AND on_date = ? AND IFNULL(meeting_id, '') = ?").bind(memberId, skip.onDate, skip.meetingId ?? ''),
  ]);
  return rev;
}

/**
 * PATCH /settings in one statement: the fields present replace the stored ones, the rest stay (or take the
 * defaults on the first write), and rev goes up. Nothing is re-planned; the next minute's scan reads the new
 * values.
 * 一条语句完成 PATCH /settings：出现的字段替换已存的值，其余保持不变（第一次写入时取默认值），rev 加一。不需要重新安排任何提醒；
 * 下一分钟的扫描会读取新值。
 */
export async function writeTimetableSettings(
  db: D1Database,
  memberId: string,
  patch: UpdateTimetableSettingsBody,
  nowMs: number,
): Promise<TimetableWrite<TimetableSettings>> {
  const defaults = DEFAULT_TIMETABLE_SETTINGS;
  const row = await db
    .prepare(
      `INSERT INTO timetable_settings (member_id, rev, class_reminders, class_lead_min, assignment_offsets, show_weekend, locale, updated_at)
       VALUES (?1, 1, COALESCE(?2, ?7), COALESCE(?3, ?8), COALESCE(?4, ?9), COALESCE(?5, ?10), COALESCE(?6, ?11), ?12)
       ON CONFLICT (member_id) DO UPDATE SET
         class_reminders = COALESCE(?2, class_reminders),
         class_lead_min = COALESCE(?3, class_lead_min),
         assignment_offsets = COALESCE(?4, assignment_offsets),
         show_weekend = COALESCE(?5, show_weekend),
         locale = COALESCE(?6, locale),
         rev = rev + 1,
         updated_at = excluded.updated_at
       RETURNING rev, class_reminders, class_lead_min, assignment_offsets, show_weekend, locale`,
    )
    .bind(
      memberId,
      patch.classReminders === undefined ? null : patch.classReminders ? 1 : 0,
      patch.classLeadMin ?? null,
      patch.assignmentOffsets === undefined ? null : JSON.stringify(patch.assignmentOffsets),
      patch.showWeekend ?? null,
      patch.locale ?? null,
      defaults.classReminders ? 1 : 0,
      defaults.classLeadMin,
      JSON.stringify(defaults.assignmentOffsets),
      defaults.showWeekend,
      defaults.locale,
      iso(nowMs),
    )
    .first<SettingsRow>();
  if (!row || row.rev === null) throw new Error('timetable settings upsert returned no row');
  return { rev: row.rev, item: toSettings(row) };
}

/** One imported assignment with the done_at and reminder plan the route worked out. */
/** 一项导入的作业，带有接口算出的 done_at 和提醒安排。 */
export interface ImportedAssignment {
  assignment: Omit<SaveAssignmentBody, 'done'>;
  doneAt: string | null;
  plan: readonly PlannedAssignmentReminder[];
}

/**
 * POST /import after its pre-check, in one batch: terms, courses, the meetings of those courses (the ones they
 * no longer list deleted, the rest upserted), skips, assignments with their pending reminders replaced by the
 * new plan, and one rev bump. Each kind is one json_each statement, assignments in slices; every upsert is
 * guarded as in the single saves.
 * 预检查通过后的 POST /import，一个批次完成：学期、课程、这些课程的上课时间（删除不再列出的，其余 upsert）、停课记录、作业（其待发提醒
 * 替换为新的安排），以及一次 rev 加一。每类内容一条 json_each 语句，作业分批写入；每个 upsert 都与单独保存时一样带有所有者保护。
 */
export async function writeTimetableImport(
  db: D1Database,
  memberId: string,
  body: Pick<ImportTimetableBody, 'terms' | 'courses' | 'skips'>,
  assignments: readonly ImportedAssignment[],
  nowMs: number,
): Promise<number> {
  const now = iso(nowMs);
  const statements: D1PreparedStatement[] = [];
  if (body.terms.length > 0) {
    const terms = body.terms.map((term) => ({ id: term.id, name: term.name, startsOn: term.startsOn, endsOn: term.endsOn, skipWeeks: term.skipWeeks }));
    statements.push(
      db
        .prepare(
          `INSERT INTO timetable_terms (id, member_id, name, starts_on, ends_on, skip_weeks, created_at, updated_at)
           SELECT j.value ->> '$.id', ?1, j.value ->> '$.name', j.value ->> '$.startsOn', j.value ->> '$.endsOn', j.value ->> '$.skipWeeks', ?2, ?2
           FROM json_each(?3) j WHERE true
           ${TERM_UPDATE}`,
        )
        .bind(memberId, now, JSON.stringify(terms)),
    );
  }
  if (body.courses.length > 0) {
    const courses = body.courses.map((course) => ({
      id: course.id,
      termId: course.termId,
      code: course.code,
      title: course.title,
      color: course.color,
      notes: course.notes,
      remind: course.remind ? 1 : 0,
    }));
    const meetings = body.courses.flatMap((course) => course.meetings.map((meeting) => meetingJson(meeting, course.id)));
    statements.push(
      db
        .prepare(
          `INSERT INTO timetable_courses (id, member_id, term_id, code, title, color, notes, remind, created_at, updated_at)
           SELECT j.value ->> '$.id', ?1, j.value ->> '$.termId', j.value ->> '$.code', j.value ->> '$.title', j.value ->> '$.color',
                  j.value ->> '$.notes', j.value ->> '$.remind', ?2, ?2
           FROM json_each(?3) j WHERE true
           ${COURSE_UPDATE}`,
        )
        .bind(memberId, now, JSON.stringify(courses)),
      db
        .prepare(
          'DELETE FROM timetable_meetings WHERE member_id = ?1 AND course_id IN (SELECT value FROM json_each(?2)) AND id NOT IN (SELECT value FROM json_each(?3))',
        )
        .bind(memberId, JSON.stringify(courses.map((course) => course.id)), JSON.stringify(meetings.map((meeting) => meeting.id))),
    );
    if (meetings.length > 0) {
      statements.push(
        db
          .prepare(
            `INSERT INTO timetable_meetings (id, course_id, member_id, kind, section, weekday, start_min, end_min, location, week_rule, week_list, created_at, updated_at)
             SELECT j.value ->> '$.id', j.value ->> '$.courseId', ?1, j.value ->> '$.kind', j.value ->> '$.section', j.value ->> '$.weekday',
                    j.value ->> '$.startMin', j.value ->> '$.endMin', j.value ->> '$.location', j.value ->> '$.weekRule', j.value ->> '$.weekList', ?2, ?2
             FROM json_each(?3) j
             WHERE EXISTS (SELECT 1 FROM timetable_courses c WHERE c.id = j.value ->> '$.courseId' AND c.member_id = ?1)
             ${MEETING_UPDATE}`,
          )
          .bind(memberId, now, JSON.stringify(meetings)),
      );
    }
  }
  if (body.skips.length > 0) {
    const skips = body.skips.map((skip) => ({ onDate: skip.onDate, meetingId: skip.meetingId, label: skip.label ?? null }));
    statements.push(
      db
        .prepare(
          `INSERT INTO timetable_skips (member_id, on_date, meeting_id, label, created_at)
           SELECT ?1, j.value ->> '$.onDate', j.value ->> '$.meetingId', j.value ->> '$.label', ?2
           FROM json_each(?3) j
           WHERE j.value ->> '$.meetingId' IS NULL
              OR EXISTS (SELECT 1 FROM timetable_meetings m WHERE m.id = j.value ->> '$.meetingId' AND m.member_id = ?1)
           ON CONFLICT DO NOTHING`,
        )
        .bind(memberId, now, JSON.stringify(skips)),
    );
  }
  for (const slice of slices(assignments, IMPORT_SLICE)) {
    const rows = slice.map(({ assignment, doneAt }) => ({
      id: assignment.id,
      courseId: assignment.courseId,
      title: assignment.title,
      notes: assignment.notes,
      dueAt: assignment.dueAt,
      remindOffsets: assignment.remindOffsets,
      doneAt,
    }));
    statements.push(
      db
        .prepare(
          `INSERT INTO timetable_assignments (id, member_id, course_id, title, notes, due_at, remind_offsets, done_at, created_at, updated_at)
           SELECT j.value ->> '$.id', ?1, ${ownCourseSql("j.value ->> '$.courseId'", '?1')}, j.value ->> '$.title', j.value ->> '$.notes', j.value ->> '$.dueAt',
                  j.value ->> '$.remindOffsets', j.value ->> '$.doneAt', ?2, ?2
           FROM json_each(?3) j WHERE true
           ${ASSIGNMENT_UPDATE}`,
        )
        .bind(memberId, now, JSON.stringify(rows)),
      db
        .prepare("DELETE FROM timetable_reminders WHERE assignment_id IN (SELECT value FROM json_each(?1)) AND member_id = ?2 AND +status = 'pending'")
        .bind(JSON.stringify(rows.map((row) => row.id)), memberId),
    );
    const plans = slice.flatMap(({ assignment, plan }) => planRows(assignment.id, assignment.dueAt, plan));
    if (plans.length > 0) statements.push(db.prepare(PLAN_INSERT).bind(memberId, now, JSON.stringify(plans)));
  }
  const { rev } = await runWrite(db, memberId, now, statements);
  return rev;
}

/**
 * POST /clear (清空课表): terms (their courses cascade), term-less courses, assignments and skips go, with every
 * reminder row through the cascades; the settings are kept and rev goes up.
 * POST /clear（清空课表）：删除学期（其课程级联删除）、不属于学期的课程、作业和停课记录，提醒记录随级联一并删除；保留设置，rev 加一。
 */
export async function clearTimetable(db: D1Database, memberId: string, nowMs: number): Promise<number> {
  const now = iso(nowMs);
  // Assignments go first, so the course deletes have no course_id to set to NULL.
  // 先删除作业，这样删除课程时没有需要置为 NULL 的 course_id。
  const { rev } = await runWrite(db, memberId, now, [
    db.prepare('DELETE FROM timetable_assignments WHERE member_id = ?').bind(memberId),
    db.prepare('DELETE FROM timetable_skips WHERE member_id = ?').bind(memberId),
    db.prepare('DELETE FROM timetable_terms WHERE member_id = ?').bind(memberId),
    db.prepare('DELETE FROM timetable_courses WHERE member_id = ?').bind(memberId),
  ]);
  return rev;
}
