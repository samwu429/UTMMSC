import {
  isTimetableId,
  planAssignmentReminders,
  skipKey,
  TIMETABLE_LIMITS,
  TIMETABLE_MESSAGES,
  type ImportTimetableBody,
  type PlannedAssignmentReminder,
  type SaveAssignmentBody,
  type SaveCourseBody,
  type SaveTermBody,
  type TimetableErrorCode,
  type TimetableIdPrefix,
  type TimetableReadResult,
  type TimetableSkip,
} from '@utmmsc/shared';

/**
 * The timetable routes' input and the checks that need what the database already holds. The shared readers in
 * timetable/rules.ts clean and check each body; this module turns their refusals into one error, reads the path
 * and query, and decides from the pre-check facts whether a write may go ahead. It knows no SQL and no HTTP.
 * 课表接口的输入，以及需要结合数据库现有内容的检查。共享的 timetable/rules.ts 中的读取函数负责清理和检查每个请求体；
 * 本模块把它们的拒绝统一成一种错误，读取路径和查询参数，并根据预检查得到的事实决定写入能否进行。这里不涉及 SQL 和 HTTP。
 */

/**
 * A refused timetable request, with the code and Chinese text of TIMETABLE_MESSAGES. Domain code does not know
 * HTTP, so the routes turn it into a response with the status each code has.
 * 被拒绝的课表请求，带有 TIMETABLE_MESSAGES 中的错误码和中文提示。领域代码不涉及 HTTP，由接口按各错误码的状态码转换成响应。
 */
export class TimetableInputError extends Error {
  constructor(
    public readonly code: TimetableErrorCode,
    message: string = TIMETABLE_MESSAGES[code],
  ) {
    super(message);
  }
}

/** The value of a shared reader's answer, or its refusal thrown. */
/** 共享读取函数结果中的值；被拒绝时抛出该拒绝。 */
export function unwrapTimetableInput<T>(result: TimetableReadResult<T>): T {
  if (!result.ok) throw new TimetableInputError(result.code, result.message);
  return result.value;
}

/** Throws the refusal when there is one. */
/** 有拒绝时将其抛出。 */
export function refuseTimetable(problem: TimetableErrorCode | null): void {
  if (problem) throw new TimetableInputError(problem);
}

/** An id from the path, such as DELETE /courses/:id, of the kind the route names. */
/** 路径中的 id（例如 DELETE /courses/:id），类型必须与接口相符。 */
export function readTimetablePathId(raw: string | undefined, prefix: TimetableIdPrefix): string {
  if (!isTimetableId(raw, prefix)) throw new TimetableInputError('invalid_id');
  return raw;
}

/** Largest rev ?rev= may name; a member's rev never comes near it. */
/** ?rev= 可以写的最大值；成员的 rev 永远不会接近它。 */
const REV_MAX = Number.MAX_SAFE_INTEGER;

/**
 * GET ?rev=N: the rev the app already has, or null for the whole timetable. Anything that is not a whole number
 * from 0 up is read as absent, so a client that sends something odd simply gets everything.
 * GET ?rev=N：App 已有的 rev；为 null 时返回整个课表。不是从 0 起的整数时视为缺省，发送了异常值的客户端只会收到全部数据。
 */
export function readRevQuery(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d{1,16}$/.test(raw)) return null;
  const rev = Number(raw);
  return Number.isSafeInteger(rev) && rev <= REV_MAX ? rev : null;
}

/** PATCH /assignments/:id: { done: boolean }. */
/** PATCH /assignments/:id：{ done: boolean }。 */
export function readDoneBody(value: unknown): boolean {
  const done = typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as { done?: unknown }).done : undefined;
  if (typeof done !== 'boolean') throw new TimetableInputError('invalid_body');
  return done;
}

/**
 * Whether a POST /skips body names a label. Saving a skip again changes its label only when the body has one
 * (null clears it), so a repeat without one, as the outbox may send, keeps the label already there.
 * POST /skips 的请求体是否带有 label。再次保存停课记录时，只有请求体带有 label 才修改（null 表示清除），
 * 因此不带 label 的重复请求（发送队列可能发出）会保留已有的名称。
 */
export function skipLabelGiven(value: unknown): boolean {
  return typeof value === 'object' && value !== null && (value as { label?: unknown }).label !== undefined;
}

/**
 * done_at after a save: done omitted keeps what is stored, true keeps an earlier tick or ticks it now, false
 * clears it.
 * 保存后的 done_at：省略 done 时保留已存的值；true 时保留更早的勾选时间，否则记为现在；false 时清除。
 */
export function doneAtFor(stored: string | null | undefined, done: boolean | undefined, nowIso: string): string | null {
  if (done === undefined) return stored ?? null;
  return done ? (stored ?? nowIso) : null;
}

/** The reminders to plan for an assignment with this done_at: none once it is done. */
/** 按此 done_at 需要为作业安排的提醒：已完成时没有。 */
export function assignmentPlan(assignment: Pick<SaveAssignmentBody, 'dueAt' | 'remindOffsets'>, doneAt: string | null, nowMs: number): PlannedAssignmentReminder[] {
  return doneAt === null ? planAssignmentReminders(assignment.dueAt, assignment.remindOffsets, nowMs) : [];
}

/* Pre-check facts */

/** The member's counts, for the limits of TIMETABLE_LIMITS. */
/** 成员现有的数量，用于 TIMETABLE_LIMITS 中的上限。 */
export interface TimetableCounts {
  terms: number;
  courses: number;
  /** Assignments with done_at NULL. */
  /** done_at 为 NULL 的作业。 */
  openAssignments: number;
  /**
   * The assignments GET still returns: open ones and those done in the last 30 days. Older done rows are left out,
   * since the app no longer shows them and the member could not clear them to make room.
   * GET 仍会返回的作业：未完成的，以及最近 30 天内完成的。更早完成的行不计入，因为 App 已不再显示它们，成员也无法清除它们来腾出空间。
   */
  assignments: number;
  skips: number;
}

/**
 * What the database holds for the ids a write names, whoever owns them, plus the member's counts. An id that
 * is missing from a map does not exist. These facts are never sent back, so a refusal tells nothing about
 * another member's rows.
 * 数据库中与写入所涉 id 有关的内容（不论属于谁），以及成员现有的数量。不在映射中的 id 不存在。这些事实从不返回给客户端，
 * 因此拒绝不会透露另一位成员的任何数据。
 */
export interface TimetableFacts {
  /** Term id to its owner. */
  /** 学期 id 到其所有者。 */
  terms: ReadonlyMap<string, string>;
  /** Course id to its owner. */
  /** 课程 id 到其所有者。 */
  courses: ReadonlyMap<string, string>;
  meetings: ReadonlyMap<string, { memberId: string; courseId: string }>;
  assignments: ReadonlyMap<string, { memberId: string; doneAt: string | null }>;
  /** skipKey of the member's skips among those named. */
  /** 所涉停课记录中成员已有的那些，以 skipKey 表示。 */
  skips: ReadonlySet<string>;
  counts: TimetableCounts;
}

export function emptyTimetableFacts(): TimetableFacts {
  return { terms: new Map(), courses: new Map(), meetings: new Map(), assignments: new Map(), skips: new Set(), counts: { terms: 0, courses: 0, openAssignments: 0, assignments: 0, skips: 0 } };
}

function takenBy(owner: string | undefined, memberId: string): boolean {
  return owner !== undefined && owner !== memberId;
}

/**
 * POST /courses: id_taken when another member owns the course or a meeting id, or a meeting id belongs to
 * another course; term_not_found when the term is not the member's; too_many_courses for a new course past
 * the limit.
 * POST /courses：另一位成员拥有该课程或某个上课时间 id，或某个上课时间 id 属于另一门课程时为 id_taken；学期不是成员自己的时为
 * term_not_found；新课程超出上限时为 too_many_courses。
 */
export function courseSaveProblem(memberId: string, body: SaveCourseBody, facts: TimetableFacts): TimetableErrorCode | null {
  if (takenBy(facts.courses.get(body.id), memberId)) return 'id_taken';
  for (const meeting of body.meetings) {
    const stored = facts.meetings.get(meeting.id);
    if (stored && (stored.memberId !== memberId || stored.courseId !== body.id)) return 'id_taken';
  }
  if (body.termId !== null && facts.terms.get(body.termId) !== memberId) return 'term_not_found';
  if (!facts.courses.has(body.id) && facts.counts.courses >= TIMETABLE_LIMITS.courses) return 'too_many_courses';
  return null;
}

/** POST /terms: id_taken when another member owns the id; too_many_terms for a new term past the limit. */
/** POST /terms：另一位成员拥有该 id 时为 id_taken；新学期超出上限时为 too_many_terms。 */
export function termSaveProblem(memberId: string, body: SaveTermBody, facts: TimetableFacts): TimetableErrorCode | null {
  if (takenBy(facts.terms.get(body.id), memberId)) return 'id_taken';
  if (!facts.terms.has(body.id) && facts.counts.terms >= TIMETABLE_LIMITS.terms) return 'too_many_terms';
  return null;
}

/**
 * Whether a change of open assignments goes past the limit. Only a change that adds open items is refused, so
 * a member already over it (after an import race) can still edit and tick off what they have.
 * 未完成作业数量的变化是否超出上限。只拒绝会增加未完成作业的变化，因此已经超出上限的成员（例如导入时的并发）仍可编辑和勾选已有的作业。
 */
function openPastLimit(before: number, after: number): boolean {
  return after > before && after > TIMETABLE_LIMITS.openAssignments;
}

/**
 * POST /assignments and PATCH /assignments/:id: id_taken when another member owns the id; course_not_found
 * when the course is not the member's; too_many_assignments when the save would add an open item past the limit;
 * too_many_assignments_total when a new assignment, done or not, would pass TIMETABLE_LIMITS.assignments.
 * POST /assignments 与 PATCH /assignments/:id：另一位成员拥有该 id 时为 id_taken；课程不是成员自己的时为 course_not_found；
 * 保存会让未完成的作业超出上限时为 too_many_assignments；新作业（不论是否完成）会超出 TIMETABLE_LIMITS.assignments 时为
 * too_many_assignments_total。
 */
export function assignmentSaveProblem(
  memberId: string,
  body: Pick<SaveAssignmentBody, 'id' | 'courseId'>,
  doneAt: string | null,
  facts: TimetableFacts,
): TimetableErrorCode | null {
  const stored = facts.assignments.get(body.id);
  if (stored && stored.memberId !== memberId) return 'id_taken';
  if (body.courseId !== null && facts.courses.get(body.courseId) !== memberId) return 'course_not_found';
  const before = facts.counts.openAssignments;
  const after = before - (stored && stored.doneAt === null ? 1 : 0) + (doneAt === null ? 1 : 0);
  if (openPastLimit(before, after)) return 'too_many_assignments';
  // Only a new row counts, so a member at the limit can still edit, tick and reopen what they have.
  // 只计算新的行，因此达到上限的成员仍可编辑、勾选和重新打开已有的作业。
  if (!stored && facts.counts.assignments >= TIMETABLE_LIMITS.assignments) return 'too_many_assignments_total';
  return null;
}

/**
 * POST /skips with skipped true: course_not_found when the meeting is not the member's (it was deleted with its
 * course); too_many_skips for a new date past the limit.
 * POST /skips 且 skipped 为 true：上课时间不是成员自己的（已随课程删除）时为 course_not_found；新的停课日期超出上限时为 too_many_skips。
 */
export function skipSaveProblem(memberId: string, skip: Pick<TimetableSkip, 'onDate' | 'meetingId'>, facts: TimetableFacts): TimetableErrorCode | null {
  if (skip.meetingId !== null && facts.meetings.get(skip.meetingId)?.memberId !== memberId) return 'course_not_found';
  if (!facts.skips.has(skipKey(skip.onDate, skip.meetingId)) && facts.counts.skips >= TIMETABLE_LIMITS.skips) return 'too_many_skips';
  return null;
}

/** Every id an import names, for the pre-check: its own ids and the terms, courses and meetings it points at. */
/** 导入涉及的所有 id，用于预检查：导入本身的 id，以及它引用的学期、课程和上课时间。 */
export interface ImportNames {
  termIds: string[];
  courseIds: string[];
  meetingIds: string[];
  assignmentIds: string[];
}

function distinct(values: Iterable<string | null>): string[] {
  const out = new Set<string>();
  for (const value of values) if (value !== null) out.add(value);
  return [...out];
}

export function importNames(body: ImportTimetableBody): ImportNames {
  return {
    termIds: distinct([...body.terms.map((term) => term.id), ...body.courses.map((course) => course.termId)]),
    courseIds: distinct([...body.courses.map((course) => course.id), ...body.assignments.map((assignment) => assignment.courseId)]),
    meetingIds: distinct([...body.courses.flatMap((course) => course.meetings.map((meeting) => meeting.id)), ...body.skips.map((skip) => skip.meetingId)]),
    assignmentIds: body.assignments.map((assignment) => assignment.id),
  };
}

/**
 * done_at of each imported assignment, with the same rule as a single save: done omitted keeps what is stored.
 * 每项导入作业的 done_at，规则与单独保存相同：省略 done 时保留已存的值。
 */
export function importDoneAts(body: ImportTimetableBody, facts: TimetableFacts, nowIso: string): Map<string, string | null> {
  return new Map(body.assignments.map((assignment) => [assignment.id, doneAtFor(facts.assignments.get(assignment.id)?.doneAt, assignment.done, nowIso)]));
}

/**
 * POST /import, after readImport: any id another member owns, or a meeting id of another course, is id_taken; a
 * course's term must be in the import or the member's, and likewise an assignment's course (course_not_found)
 * and a skip's meeting (course_not_found); then every limit is counted with what the member already has, where
 * a row the import only updates is not counted twice. Done assignments count towards the total
 * (too_many_assignments_total), so an import of done items cannot add rows without end.
 * POST /import，在 readImport 之后：另一位成员拥有的任何 id，或属于另一门课程的上课时间 id，都为 id_taken；课程的学期必须在导入中
 * 或属于成员自己，作业的课程（course_not_found）和停课记录的上课时间（course_not_found）同理；最后按成员已有的数量计算每个上限，
 * 导入只是更新的行不会重复计算。已完成的作业计入总数（too_many_assignments_total），导入已完成的作业因此不能无限增加行数。
 */
export function importProblem(memberId: string, body: ImportTimetableBody, doneAts: ReadonlyMap<string, string | null>, facts: TimetableFacts): TimetableErrorCode | null {
  for (const term of body.terms) if (takenBy(facts.terms.get(term.id), memberId)) return 'id_taken';
  for (const course of body.courses) {
    if (takenBy(facts.courses.get(course.id), memberId)) return 'id_taken';
    for (const meeting of course.meetings) {
      const stored = facts.meetings.get(meeting.id);
      if (stored && (stored.memberId !== memberId || stored.courseId !== course.id)) return 'id_taken';
    }
  }
  for (const assignment of body.assignments) if (takenBy(facts.assignments.get(assignment.id)?.memberId, memberId)) return 'id_taken';

  const importedTerms = new Set(body.terms.map((term) => term.id));
  const importedCourses = new Set(body.courses.map((course) => course.id));
  const importedMeetings = new Set(body.courses.flatMap((course) => course.meetings.map((meeting) => meeting.id)));
  for (const course of body.courses) {
    if (course.termId !== null && !importedTerms.has(course.termId) && facts.terms.get(course.termId) !== memberId) return 'term_not_found';
  }
  for (const assignment of body.assignments) {
    if (assignment.courseId !== null && !importedCourses.has(assignment.courseId) && facts.courses.get(assignment.courseId) !== memberId) return 'course_not_found';
  }
  for (const skip of body.skips) {
    if (skip.meetingId !== null && !importedMeetings.has(skip.meetingId) && facts.meetings.get(skip.meetingId)?.memberId !== memberId) return 'course_not_found';
  }

  const { counts } = facts;
  if (counts.terms + body.terms.filter((term) => !facts.terms.has(term.id)).length > TIMETABLE_LIMITS.terms) return 'too_many_terms';
  if (counts.courses + body.courses.filter((course) => !facts.courses.has(course.id)).length > TIMETABLE_LIMITS.courses) return 'too_many_courses';
  let open = counts.openAssignments;
  for (const assignment of body.assignments) {
    if (facts.assignments.get(assignment.id)?.doneAt === null) open -= 1;
    if ((doneAts.get(assignment.id) ?? null) === null) open += 1;
  }
  if (openPastLimit(counts.openAssignments, open)) return 'too_many_assignments';
  const newAssignments = body.assignments.filter((assignment) => !facts.assignments.has(assignment.id)).length;
  if (newAssignments > 0 && counts.assignments + newAssignments > TIMETABLE_LIMITS.assignments) return 'too_many_assignments_total';
  const newSkips = body.skips.filter((skip) => !facts.skips.has(skipKey(skip.onDate, skip.meetingId))).length;
  if (newSkips > 0 && counts.skips + newSkips > TIMETABLE_LIMITS.skips) return 'too_many_skips';
  return null;
}
