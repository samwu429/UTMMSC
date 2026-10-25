import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import {
  readAssignment,
  readCourse,
  readImport,
  readSettingsPatch,
  readSkip,
  readTerm,
  TIMETABLE_MESSAGES,
  type DeleteTimetableItemResponse,
  type ImportTimetableResponse,
  type SaveAssignmentResponse,
  type SaveCourseResponse,
  type SaveTermResponse,
  type SetSkipResponse,
  type TimetableErrorCode,
  type TimetableResponse,
  type TimetableUnchanged,
  type UpdateTimetableSettingsResponse,
} from '@utmmsc/shared';
import {
  assignmentPlan,
  assignmentSaveProblem,
  courseSaveProblem,
  doneAtFor,
  emptyTimetableFacts,
  importDoneAts,
  importNames,
  importProblem,
  readDoneBody,
  readRevQuery,
  readTimetablePathId,
  refuseTimetable,
  skipLabelGiven,
  skipSaveProblem,
  termSaveProblem,
  TimetableInputError,
  unwrapTimetableInput,
} from '../../../domain/timetable/input';
import { isMissingSchemaError } from '../../../infrastructure/d1/channels';
import { isForeignKeyError } from '../../../infrastructure/d1/moments';
import {
  clearTimetable,
  deleteTimetableAssignment,
  deleteTimetableCourse,
  deleteTimetableSkip,
  deleteTimetableTerm,
  findTimetableAssignment,
  loadTimetable,
  readTimetableFacts,
  readTimetableHead,
  writeTimetableAssignment,
  writeTimetableCourse,
  writeTimetableImport,
  writeTimetableSettings,
  writeTimetableSkip,
  writeTimetableTerm,
  type ImportedAssignment,
} from '../../../infrastructure/d1/timetable';
import type { AppEnv } from '../../context';
import { ApiHttpError, errorResponse, notFound, serviceUnavailable } from '../../errors';
import { memberRateLimit } from '../../middleware/rate-limit';
import { requireSession } from '../../middleware/session';
import { readJson } from '../../validation';

/**
 * 自定义课表, mounted at /home/timetable. Everything here is the signed-in member's own: every route needs a
 * session, every statement binds the session's member id, and no answer ever carries another member's data, a
 * 409 included. Writes share one per-member limit, and /import has a tighter one of its own. The app keeps an
 * offline outbox, so deletes are idempotent and saves are upserts by the ids the app chose.
 * 自定义课表，挂载在 /home/timetable。这里的一切都只属于已登录的成员：每个接口都需要登录，每条语句都绑定会话成员的 id，
 * 任何应答（包括 409）都不会带有另一位成员的数据。所有写入共用一份按成员计算的频率限制，/import 另有一份更严格的限制。
 * App 有离线发送队列，因此删除是幂等的，保存则按 App 生成的 id 进行 upsert。
 */
export const timetableRoutes = new Hono<AppEnv>();

/** Writes per member per minute, every write route together. */
/** 每位成员每分钟的写入次数，所有写入接口合计。 */
export const TIMETABLE_WRITES_PER_MINUTE = 120;

/**
 * Imports per member per window, on top of the write limit. One import can write a thousand rows, and a member
 * imports a calendar file a few times a term at most.
 * 每位成员每个时间窗口内的导入次数，在写入限制之外另行计算。一次导入可以写入上千行，而成员每学期最多导入几次日历文件。
 */
export const TIMETABLE_IMPORTS_PER_WINDOW = 5;
export const TIMETABLE_IMPORT_WINDOW_MS = 10 * 60_000;

/** Codes that are not 400. */
/** 不是 400 的错误码。 */
const STATUS: Partial<Record<TimetableErrorCode, ContentfulStatusCode>> = {
  term_not_found: 404,
  course_not_found: 404,
  id_taken: 409,
  timetable_unavailable: 503,
};

export const timetableUnavailable = () => serviceUnavailable('timetable_unavailable', TIMETABLE_MESSAGES.timetable_unavailable);

/**
 * A refusal from the domain as the response it stands for. Before migration 0017 every timetable table is
 * missing, so the feature answers that it is being upgraded instead of 500.
 * 把领域层的拒绝转换成对应的响应。迁移 0017 之前课表的表都不存在，此时回答功能正在升级，而不是 500。
 */
export function timetableHttpError(err: unknown): unknown {
  if (err instanceof TimetableInputError) return new ApiHttpError(STATUS[err.code] ?? 400, err.code, err.message);
  if (isMissingSchemaError(err)) return timetableUnavailable();
  return err;
}

timetableRoutes.onError((err, c) => errorResponse(timetableHttpError(err), c));
timetableRoutes.use('*', requireSession);

const write = memberRateLimit('timetable:write', TIMETABLE_WRITES_PER_MINUTE, 60_000);
const importLimit = memberRateLimit('timetable:import', TIMETABLE_IMPORTS_PER_WINDOW, TIMETABLE_IMPORT_WINDOW_MS);

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * Runs a write whose pre-check passed. A course's term can still vanish in between (another device deleted it),
 * which fails the batch on its foreign key; that is answered as the term being gone.
 * 执行预检查已通过的写入。课程的学期仍可能在两者之间消失（另一台设备删除了它），批次会因外键失败；此时按学期已不存在回答。
 */
async function referencing<T>(gone: TimetableErrorCode, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (isForeignKeyError(err)) throw new TimetableInputError(gone);
    throw err;
  }
}

/**
 * GET /home/timetable?rev=N. The first query reads the settings row and the 课表提醒 switch; when N is still the
 * member's rev (0 before any write), that is the whole answer. Otherwise one batch reads everything. A first
 * GET writes nothing.
 * GET /home/timetable?rev=N。第一条查询读取设置记录和「课表提醒」开关；N 仍是成员当前的 rev（未写入过时为 0）时，这就是全部应答。
 * 否则用一个批次读取全部内容。第一次 GET 不写入任何内容。
 */
timetableRoutes.get('/', async (c) => {
  const memberId = c.get('member').id;
  const known = readRevQuery(c.req.query('rev'));
  const head = await readTimetableHead(c.env.DB, memberId);
  // A member's timetable is theirs alone; no cache on the way may keep a copy.
  // 课表只属于成员本人；途中的任何缓存都不能保留副本。
  c.header('cache-control', 'private, no-store');
  if (known !== null && known === head.rev) {
    const unchanged: TimetableUnchanged = { rev: head.rev, unchanged: true, remindersAllowed: head.remindersAllowed };
    return c.json(unchanged);
  }
  const content = await loadTimetable(c.env.DB, memberId, Date.now());
  const response: TimetableResponse = { rev: head.rev, remindersAllowed: head.remindersAllowed, settings: head.settings, ...content };
  return c.json(response);
});

/** POST /courses: SaveCourseBody, saved with its meetings by id. */
/** POST /courses：SaveCourseBody，课程连同上课时间按 id 保存。 */
timetableRoutes.post('/courses', write, async (c) => {
  const memberId = c.get('member').id;
  const course = unwrapTimetableInput(readCourse(await readJson<Record<string, unknown>>(c)));
  const facts = await readTimetableFacts(c.env.DB, memberId, {
    courseIds: [course.id],
    meetingIds: course.meetings.map((meeting) => meeting.id),
    termIds: course.termId === null ? [] : [course.termId],
    counts: ['courses'],
  });
  refuseTimetable(courseSaveProblem(memberId, course, facts));
  const saved = await referencing('term_not_found', () => writeTimetableCourse(c.env.DB, memberId, course, Date.now()));
  const response: SaveCourseResponse = { rev: saved.rev, item: saved.item };
  return c.json(response);
});

timetableRoutes.delete('/courses/:id', write, async (c) => {
  const id = readTimetablePathId(c.req.param('id'), 'tc');
  const response: DeleteTimetableItemResponse = { rev: await deleteTimetableCourse(c.env.DB, c.get('member').id, id, Date.now()), item: null };
  return c.json(response);
});

/** POST /terms: SaveTermBody. */
timetableRoutes.post('/terms', write, async (c) => {
  const memberId = c.get('member').id;
  const term = unwrapTimetableInput(readTerm(await readJson<Record<string, unknown>>(c)));
  const facts = await readTimetableFacts(c.env.DB, memberId, { termIds: [term.id], counts: ['terms'] });
  refuseTimetable(termSaveProblem(memberId, term, facts));
  const saved = await writeTimetableTerm(c.env.DB, memberId, term, Date.now());
  const response: SaveTermResponse = { rev: saved.rev, item: saved.item };
  return c.json(response);
});

/** DELETE /terms/:id also deletes the term's courses; the app says how many first. */
/** DELETE /terms/:id 会同时删除该学期的课程；App 会先说明数量。 */
timetableRoutes.delete('/terms/:id', write, async (c) => {
  const id = readTimetablePathId(c.req.param('id'), 'tt');
  const response: DeleteTimetableItemResponse = { rev: await deleteTimetableTerm(c.env.DB, c.get('member').id, id, Date.now()), item: null };
  return c.json(response);
});

/**
 * POST /assignments: SaveAssignmentBody. done omitted keeps the stored done state; the reminders are planned in
 * the same batch.
 * POST /assignments：SaveAssignmentBody。省略 done 时保留已存的完成状态；提醒在同一批次中安排。
 */
timetableRoutes.post('/assignments', write, async (c) => {
  const memberId = c.get('member').id;
  const now = Date.now();
  const body = unwrapTimetableInput(readAssignment(await readJson<Record<string, unknown>>(c), now));
  const facts = await readTimetableFacts(c.env.DB, memberId, {
    assignmentIds: [body.id],
    courseIds: body.courseId === null ? [] : [body.courseId],
    counts: ['openAssignments', 'assignments'],
    nowMs: now,
  });
  const stored = facts.assignments.get(body.id);
  const doneAt = doneAtFor(stored?.memberId === memberId ? stored.doneAt : null, body.done, iso(now));
  refuseTimetable(assignmentSaveProblem(memberId, body, doneAt, facts));
  // A course deleted since the pre-check leaves the assignment without one, as the delete itself would.
  // 预检查之后被删除的课程会让作业不再关联课程，与删除课程本身的效果相同。
  const saved = await writeTimetableAssignment(c.env.DB, memberId, body, doneAt, assignmentPlan(body, doneAt, now), now);
  const response: SaveAssignmentResponse = { rev: saved.rev, item: saved.item };
  return c.json(response);
});

/**
 * PATCH /assignments/:id { done }: true ticks it off and cancels its pending reminders; false opens it again and
 * plans again, where offsets already sent are not repeated. 404 when it is not the member's.
 * PATCH /assignments/:id { done }：true 表示勾选完成并取消尚未发送的提醒；false 表示重新打开并重新安排，已发送过的提醒时间不会重复。
 * 不属于该成员时返回 404。
 */
timetableRoutes.patch('/assignments/:id', write, async (c) => {
  const memberId = c.get('member').id;
  const id = readTimetablePathId(c.req.param('id'), 'ta');
  const done = readDoneBody(await readJson<Record<string, unknown>>(c));
  const now = Date.now();
  const found = await findTimetableAssignment(c.env.DB, memberId, id);
  if (!found) throw notFound();
  const { assignment } = found;
  const doneAt = doneAtFor(assignment.doneAt, done, iso(now));
  // PATCH never adds a row, and only a new id counts towards the total, so the total is not read.
  // PATCH 从不新增行，而只有新的 id 才计入总数，因此不读取总数。
  const facts = {
    ...emptyTimetableFacts(),
    assignments: new Map([[id, { memberId, doneAt: assignment.doneAt }]]),
    counts: { terms: 0, courses: 0, skips: 0, openAssignments: found.openAssignments, assignments: 0 },
  };
  refuseTimetable(assignmentSaveProblem(memberId, { id, courseId: null }, doneAt, facts));
  const saved = await writeTimetableAssignment(c.env.DB, memberId, assignment, doneAt, assignmentPlan(assignment, doneAt, now), now);
  const response: SaveAssignmentResponse = { rev: saved.rev, item: saved.item };
  return c.json(response);
});

timetableRoutes.delete('/assignments/:id', write, async (c) => {
  const id = readTimetablePathId(c.req.param('id'), 'ta');
  const response: DeleteTimetableItemResponse = { rev: await deleteTimetableAssignment(c.env.DB, c.get('member').id, id, Date.now()), item: null };
  return c.json(response);
});

/**
 * POST /skips { onDate, meetingId, skipped, label? }: a holiday (meetingId null) or 本次不上, set or removed. The
 * meeting must be the member's own; removing is idempotent.
 * POST /skips { onDate, meetingId, skipped, label? }：设置或取消假日（meetingId 为 null）或「本次不上」。上课时间必须属于该成员；
 * 取消是幂等的。
 */
timetableRoutes.post('/skips', write, async (c) => {
  const memberId = c.get('member').id;
  const raw = await readJson<Record<string, unknown>>(c);
  const skip = unwrapTimetableInput(readSkip(raw));
  const now = Date.now();
  if (!skip.skipped) {
    const removed: SetSkipResponse = { rev: await deleteTimetableSkip(c.env.DB, memberId, skip, now), item: null };
    return c.json(removed);
  }
  const facts = await readTimetableFacts(c.env.DB, memberId, {
    meetingIds: skip.meetingId === null ? [] : [skip.meetingId],
    skips: [skip],
    counts: ['skips'],
  });
  refuseTimetable(skipSaveProblem(memberId, skip, facts));
  const saved = await writeTimetableSkip(c.env.DB, memberId, { onDate: skip.onDate, meetingId: skip.meetingId, label: skip.label }, skipLabelGiven(raw), now);
  // The insert is guarded by the meeting's owner, so a meeting deleted since the pre-check writes no row.
  // 插入受上课时间所有者的保护，所以预检查之后被删除的上课时间不会写入任何行。
  if (!saved.item) throw new TimetableInputError('course_not_found');
  const response: SetSkipResponse = { rev: saved.rev, item: saved.item };
  return c.json(response);
});

/** PATCH /settings: only the fields present; it takes effect at the next minute's scan. */
/** PATCH /settings：只修改出现的字段；下一分钟的扫描起生效。 */
timetableRoutes.patch('/settings', write, async (c) => {
  const patch = unwrapTimetableInput(readSettingsPatch(await readJson<Record<string, unknown>>(c)));
  const saved = await writeTimetableSettings(c.env.DB, c.get('member').id, patch, Date.now());
  const response: UpdateTimetableSettingsResponse = { rev: saved.rev, item: saved.item };
  return c.json(response);
});

/**
 * POST /import: ImportTimetableBody, checked in full first, with the limits counted after the import, then written
 * in one batch. Online only; the app fetches the timetable again afterwards. It also has its own, tighter limit.
 * POST /import：ImportTimetableBody，先完整检查，上限按导入之后的数量计算，再用一个批次写入。只能在线使用；之后 App 会重新获取课表。
 * 它另有一个更严格的频率限制。
 */
timetableRoutes.post('/import', write, importLimit, async (c) => {
  const memberId = c.get('member').id;
  const now = Date.now();
  const body = unwrapTimetableInput(readImport(await readJson<Record<string, unknown>>(c), now));
  const facts = await readTimetableFacts(c.env.DB, memberId, {
    ...importNames(body),
    skips: body.skips,
    counts: ['terms', 'courses', 'openAssignments', 'assignments', 'skips'],
    nowMs: now,
  });
  const doneAts = importDoneAts(body, facts, iso(now));
  refuseTimetable(importProblem(memberId, body, doneAts, facts));
  const assignments: ImportedAssignment[] = body.assignments.map((assignment) => {
    const doneAt = doneAts.get(assignment.id) ?? null;
    return { assignment, doneAt, plan: assignmentPlan(assignment, doneAt, now) };
  });
  // Only a course's term can still fail its foreign key: meetings, skips and assignments are written guarded.
  // 只有课程的学期仍可能违反外键：上课时间、停课记录和作业都带保护写入。
  const rev = await referencing('term_not_found', () => writeTimetableImport(c.env.DB, memberId, body, assignments, now));
  const response: ImportTimetableResponse = {
    rev,
    item: { terms: body.terms.length, courses: body.courses.length, assignments: body.assignments.length, skips: body.skips.length },
  };
  return c.json(response);
});

/** POST /clear (清空课表): everything but the settings. */
/** POST /clear（清空课表）：删除设置以外的全部内容。 */
timetableRoutes.post('/clear', write, async (c) => {
  const response: DeleteTimetableItemResponse = { rev: await clearTimetable(c.env.DB, c.get('member').id, Date.now()), item: null };
  return c.json(response);
});
