/**
 * Owner: T3, timetable web core. Applies a queued write to a snapshot the way the server will, so every screen
 * shows it at once: deleting a course drops its meetings' skips and keeps its assignments without a course, and
 * deleting a term deletes its courses, as the database cascades do. Each write is stamped with its queue time, so
 * replaying the outbox over a fresh server answer gives the same result as the first time.
 * 维护者：T3，课表网页核心。按服务器的方式把排队中的写入应用到快照上，使各页面立即显示：删除课程会去掉其上课时间的停课记录，
 * 并保留其作业（不再关联课程）；删除学期会删除其中的课程，与数据库的级联一致。每次写入都使用排队时间，因此在服务器的新应答上
 * 重放队列，得到的结果与第一次相同。
 */
import {
  DEFAULT_TIMETABLE_SETTINGS,
  type TimetableAssignment,
  type TimetableCourse,
  type TimetableResponse,
  type TimetableSkip,
  type TimetableTerm,
} from '@utmmsc/shared';
import type { TimetableMutation, TimetableOutboxItem } from './types';

/** What a member who never saved anything has. */
/** 从未保存过任何内容的成员所拥有的数据。 */
export function emptySnapshot(): TimetableResponse {
  return {
    rev: 0,
    remindersAllowed: true,
    settings: { ...DEFAULT_TIMETABLE_SETTINGS, assignmentOffsets: [...DEFAULT_TIMETABLE_SETTINGS.assignmentOffsets] },
    terms: [],
    courses: [],
    skips: [],
    assignments: [],
  };
}

function upsert<T extends { id: string }>(items: readonly T[], item: T): T[] {
  const index = items.findIndex((existing) => existing.id === item.id);
  if (index === -1) return [...items, item];
  const next = [...items];
  next[index] = item;
  return next;
}

/** Assignments stay in due order, as the server sends them. */
/** 作业保持按截止时间排序，与服务器发送的顺序一致。 */
function byDue(a: TimetableAssignment, b: TimetableAssignment): number {
  return a.dueAt < b.dueAt ? -1 : a.dueAt > b.dueAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function sameSkip(skip: Pick<TimetableSkip, 'onDate' | 'meetingId'>, onDate: string, meetingId: string | null): boolean {
  return skip.onDate === onDate && skip.meetingId === meetingId;
}

/** Removes courses and what hangs on them: their meetings' skips go, their assignments lose the course. */
/** 删除课程及其附属内容：去掉其上课时间的停课记录，其作业不再关联课程。 */
function withoutCourses(snapshot: TimetableResponse, ids: ReadonlySet<string>): TimetableResponse {
  if (ids.size === 0) return snapshot;
  const meetings = new Set<string>();
  for (const course of snapshot.courses) if (ids.has(course.id)) for (const meeting of course.meetings) meetings.add(meeting.id);
  return {
    ...snapshot,
    courses: snapshot.courses.filter((course) => !ids.has(course.id)),
    skips: snapshot.skips.filter((skip) => skip.meetingId === null || !meetings.has(skip.meetingId)),
    assignments: snapshot.assignments.map((assignment) => (assignment.courseId !== null && ids.has(assignment.courseId) ? { ...assignment, courseId: null } : assignment)),
  };
}

/**
 * A course edit can drop meetings; their skips go with them, as the meeting rows cascade on the server.
 * 修改课程可能去掉上课时间；其停课记录随之删除，与服务器上上课时间的级联一致。
 */
function dropOrphanSkips(snapshot: TimetableResponse, before: TimetableCourse | undefined, after: TimetableCourse): TimetableSkip[] {
  if (!before) return snapshot.skips;
  const kept = new Set(after.meetings.map((meeting) => meeting.id));
  const dropped = new Set(before.meetings.filter((meeting) => !kept.has(meeting.id)).map((meeting) => meeting.id));
  if (dropped.size === 0) return snapshot.skips;
  return snapshot.skips.filter((skip) => skip.meetingId === null || !dropped.has(skip.meetingId));
}

/** The snapshot after one write, stamped with the instant `atMs`. */
/** 一次写入之后的快照，时间戳为 `atMs`。 */
export function applyMutation(snapshot: TimetableResponse, mutation: TimetableMutation, atMs: number): TimetableResponse {
  const at = new Date(atMs).toISOString();
  switch (mutation.kind) {
    case 'saveCourse': {
      const course: TimetableCourse = { ...mutation.body, meetings: mutation.body.meetings.map((meeting) => ({ ...meeting })), updatedAt: at };
      const before = snapshot.courses.find((existing) => existing.id === course.id);
      return { ...snapshot, courses: upsert(snapshot.courses, course), skips: dropOrphanSkips(snapshot, before, course) };
    }
    case 'deleteCourse':
      return withoutCourses(snapshot, new Set([mutation.id]));
    case 'saveTerm': {
      const term: TimetableTerm = { ...mutation.body, skipWeeks: [...mutation.body.skipWeeks], updatedAt: at };
      return { ...snapshot, terms: upsert(snapshot.terms, term) };
    }
    case 'deleteTerm': {
      const courses = new Set(snapshot.courses.filter((course) => course.termId === mutation.id).map((course) => course.id));
      const next = withoutCourses(snapshot, courses);
      return { ...next, terms: next.terms.filter((term) => term.id !== mutation.id) };
    }
    case 'saveAssignment': {
      const { done, ...body } = mutation.body;
      const existing = snapshot.assignments.find((assignment) => assignment.id === body.id);
      // done omitted keeps the stored state, as the server does.
      // 省略 done 时保留已存的状态，与服务器一致。
      const doneAt = done === undefined ? (existing?.doneAt ?? null) : done ? (existing?.doneAt ?? at) : null;
      const assignment: TimetableAssignment = { ...body, remindOffsets: [...body.remindOffsets], doneAt, updatedAt: at };
      return { ...snapshot, assignments: upsert(snapshot.assignments, assignment).sort(byDue) };
    }
    case 'setAssignmentDone': {
      const existing = snapshot.assignments.find((assignment) => assignment.id === mutation.id);
      if (!existing) return snapshot;
      const doneAt = mutation.done ? (existing.doneAt ?? at) : null;
      if (doneAt === existing.doneAt) return snapshot;
      return { ...snapshot, assignments: upsert(snapshot.assignments, { ...existing, doneAt, updatedAt: at }) };
    }
    case 'deleteAssignment':
      return { ...snapshot, assignments: snapshot.assignments.filter((assignment) => assignment.id !== mutation.id) };
    case 'setSkip': {
      const { onDate, meetingId, skipped } = mutation.body;
      const rest = snapshot.skips.filter((skip) => !sameSkip(skip, onDate, meetingId));
      if (!skipped) return rest.length === snapshot.skips.length ? snapshot : { ...snapshot, skips: rest };
      const existing = snapshot.skips.find((skip) => sameSkip(skip, onDate, meetingId));
      const label = mutation.body.label === undefined ? (existing?.label ?? null) : mutation.body.label;
      return { ...snapshot, skips: [...rest, { onDate, meetingId, label }].sort((a, b) => (a.onDate < b.onDate ? -1 : a.onDate > b.onDate ? 1 : 0)) };
    }
    case 'updateSettings': {
      const patch = Object.fromEntries(Object.entries(mutation.patch).filter(([, value]) => value !== undefined));
      return { ...snapshot, settings: { ...snapshot.settings, ...patch } };
    }
    case 'clear':
      return { ...snapshot, terms: [], courses: [], skips: [], assignments: [] };
  }
}

/** Replays queued writes, in order, over a snapshot. */
/** 按顺序在快照上重放排队中的写入。 */
export function applyOutbox(snapshot: TimetableResponse, outbox: readonly TimetableOutboxItem[]): TimetableResponse {
  let next = snapshot;
  for (const item of outbox) next = applyMutation(next, item.mutation, item.queuedAt);
  return next;
}

/**
 * Puts what the server stored (codes uppercased, text trimmed, its own updatedAt) in place of the optimistic copy.
 * 用服务器保存的内容（大写的课程代码、去掉首尾空白的文字、服务器的 updatedAt）替换乐观写入的副本。
 */
export function mergeServerItem(snapshot: TimetableResponse, mutation: TimetableMutation, item: unknown): TimetableResponse {
  if (item === null || item === undefined || typeof item !== 'object') return snapshot;
  switch (mutation.kind) {
    case 'saveCourse': {
      const course = item as TimetableCourse;
      if (course.id !== mutation.body.id || !Array.isArray(course.meetings)) return snapshot;
      return { ...snapshot, courses: upsert(snapshot.courses, course) };
    }
    case 'saveTerm': {
      const term = item as TimetableTerm;
      if (term.id !== mutation.body.id) return snapshot;
      return { ...snapshot, terms: upsert(snapshot.terms, term) };
    }
    case 'saveAssignment':
    case 'setAssignmentDone': {
      const assignment = item as TimetableAssignment;
      const id = mutation.kind === 'saveAssignment' ? mutation.body.id : mutation.id;
      if (assignment.id !== id || !Array.isArray(assignment.remindOffsets)) return snapshot;
      return { ...snapshot, assignments: upsert(snapshot.assignments, assignment).sort(byDue) };
    }
    case 'updateSettings':
      return { ...snapshot, settings: { ...snapshot.settings, ...(item as object) } };
    default:
      return snapshot;
  }
}
