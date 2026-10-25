/**
 * Owner: T3, timetable web core. The offline outbox: how a new write joins the queue, which ids still wait to sync
 * (待同步), and how failures are retried.
 * Coalescing follows three rules. A later save of the same item replaces the queued one in place, unless the item
 * it now refers to (a course's term, an assignment's course) is queued after it; then both are kept, since sending
 * twice is harmless but sending in the wrong order is refused. A delete removes the queued saves of that item and
 * goes to the end, after anything that still refers to it. Deleting something never sent cancels both writes, and
 * queued writes that refer to it are fixed up the way the server would have.
 * The item being sent is never touched.
 * 维护者：T3，课表网页核心。离线发送队列：新的写入如何加入队列、哪些 id 仍在等待同步（待同步），以及失败后如何重试。
 * 合并遵循三条规则。对同一条目的后续保存会原地替换排队中的保存，除非它现在引用的条目（课程的学期、作业的课程）排在它之后；
 * 此时两条都保留，因为发送两次无害，顺序错了却会被拒绝。删除会去掉该条目排队中的保存并排到队尾，放在仍引用它的写入之后。
 * 删除尚未发送的条目会同时取消两次写入，引用它的排队写入按服务器的方式修正。
 * 正在发送的那一条永远不会被改动。
 */
import { ApiClientError } from '../../../shared/api/errors';
import type { TimetableResponse } from '@utmmsc/shared';
import type { TimetableMutation, TimetableOutboxItem } from './types';

/** The item a write is about; writes with the same key coalesce. */
/** 写入所针对的条目；键相同的写入会合并。 */
export function mutationKey(mutation: TimetableMutation): string {
  switch (mutation.kind) {
    case 'saveCourse':
      return `course:${mutation.body.id}`;
    case 'deleteCourse':
      return `course:${mutation.id}`;
    case 'saveTerm':
      return `term:${mutation.body.id}`;
    case 'deleteTerm':
      return `term:${mutation.id}`;
    case 'saveAssignment':
      return `assignment:${mutation.body.id}`;
    case 'setAssignmentDone':
    case 'deleteAssignment':
      return `assignment:${mutation.id}`;
    case 'setSkip':
      return `skip:${mutation.body.onDate}|${mutation.body.meetingId ?? '*'}`;
    case 'updateSettings':
      return 'settings';
    case 'clear':
      return 'clear';
  }
}

function courseOfMeeting(snapshot: TimetableResponse, meetingId: string): string | null {
  for (const course of snapshot.courses) if (course.meetings.some((meeting) => meeting.id === meetingId)) return course.id;
  return null;
}

/** Keys of the items a write refers to, which must reach the server first. */
/** 写入所引用的条目的键，这些条目必须先到达服务器。 */
function dependencies(mutation: TimetableMutation, snapshot: TimetableResponse): string[] {
  switch (mutation.kind) {
    case 'saveCourse':
      return mutation.body.termId ? [`term:${mutation.body.termId}`] : [];
    case 'saveAssignment':
      return mutation.body.courseId ? [`course:${mutation.body.courseId}`] : [];
    case 'setSkip': {
      const course = mutation.body.meetingId ? courseOfMeeting(snapshot, mutation.body.meetingId) : null;
      return course ? [`course:${course}`] : [];
    }
    default:
      return [];
  }
}

/** Whether the item exists in the snapshot, i.e. the write edits rather than creates. */
/** 条目是否已在快照中，即这次写入是修改而非新建。 */
function exists(mutation: TimetableMutation, snapshot: TimetableResponse): boolean {
  switch (mutation.kind) {
    case 'saveCourse':
      return snapshot.courses.some((course) => course.id === mutation.body.id);
    case 'saveTerm':
      return snapshot.terms.some((term) => term.id === mutation.body.id);
    case 'saveAssignment':
      return snapshot.assignments.some((assignment) => assignment.id === mutation.body.id);
    case 'setSkip':
      return snapshot.skips.some((skip) => skip.onDate === mutation.body.onDate && skip.meetingId === mutation.body.meetingId);
    default:
      return true;
  }
}

function isDelete(mutation: TimetableMutation): boolean {
  return mutation.kind === 'deleteCourse' || mutation.kind === 'deleteTerm' || mutation.kind === 'deleteAssignment' || (mutation.kind === 'setSkip' && !mutation.body.skipped);
}

export interface EnqueueContext {
  id: string;
  queuedAt: number;
  /** The id of the item being sent, which must stay as it is. */
  /** 正在发送的那一条的 id，必须保持不变。 */
  sendingId: string | null;
  /** The snapshot before this write was applied. */
  /** 应用这次写入之前的快照。 */
  before: TimetableResponse;
}

function lastIndexOfKey(outbox: readonly TimetableOutboxItem[], key: string, skip: number): number {
  for (let i = outbox.length - 1; i >= 0; i -= 1) if (i !== skip && outbox[i]?.key === key) return i;
  return -1;
}

/** Ids of a course's meetings, from the queued save or the snapshot. */
/** 课程的上课时间 id，取自排队中的保存或快照。 */
function meetingIdsOf(courseId: string, queued: TimetableOutboxItem | undefined, before: TimetableResponse): Set<string> {
  const ids = new Set<string>();
  if (queued?.mutation.kind === 'saveCourse') for (const meeting of queued.mutation.body.meetings) ids.add(meeting.id);
  for (const course of before.courses) if (course.id === courseId) for (const meeting of course.meetings) ids.add(meeting.id);
  return ids;
}

/**
 * The queue after cancelling a never-sent item: writes that refer to it are changed as the server would have
 * changed the rows (an assignment loses the course, a single skip of its meetings goes), and for a term the
 * cancel only happens when nothing queued refers to it.
 * 取消一个从未发送的条目之后的队列：引用它的写入按服务器修改数据的方式调整（作业不再关联课程，其上课时间的单次停课被去掉）；
 * 对于学期，只有在队列中没有任何写入引用它时才会取消。
 */
function cancelFresh(outbox: TimetableOutboxItem[], index: number, mutation: TimetableMutation, ctx: EnqueueContext): TimetableOutboxItem[] | null {
  const queued = outbox[index];
  if (!queued) return null;
  const rest = outbox.filter((_, i) => i !== index);
  if (mutation.kind === 'deleteTerm') {
    const referred = rest.some((item) => item.mutation.kind === 'saveCourse' && item.mutation.body.termId === mutation.id);
    return referred ? null : rest;
  }
  if (mutation.kind !== 'deleteCourse') return rest;
  const meetings = meetingIdsOf(mutation.id, queued, ctx.before);
  const out: TimetableOutboxItem[] = [];
  for (const item of rest) {
    const m = item.mutation;
    if (m.kind === 'saveAssignment' && m.body.courseId === mutation.id && item.id !== ctx.sendingId) {
      out.push({ ...item, mutation: { ...m, body: { ...m.body, courseId: null } } });
    } else if (m.kind === 'setSkip' && m.body.meetingId !== null && meetings.has(m.body.meetingId) && item.id !== ctx.sendingId) {
      continue;
    } else {
      out.push(item);
    }
  }
  return out;
}

/** A write folded into the queued write of the same item, or null when they cannot be folded. */
/** 合并进同一条目排队写入后的写入；无法合并时为 null。 */
function fold(queued: TimetableMutation, next: TimetableMutation): TimetableMutation | null {
  if (next.kind === 'updateSettings' && queued.kind === 'updateSettings') return { kind: 'updateSettings', patch: { ...queued.patch, ...next.patch } };
  if (next.kind === 'setAssignmentDone' && queued.kind === 'saveAssignment') return { kind: 'saveAssignment', body: { ...queued.body, done: next.done } };
  if (next.kind === 'saveAssignment' && queued.kind === 'setAssignmentDone' && next.body.done === undefined) {
    return { kind: 'saveAssignment', body: { ...next.body, done: queued.done } };
  }
  if (next.kind === 'saveAssignment' && queued.kind === 'saveAssignment' && next.body.done === undefined && queued.body.done !== undefined) {
    return { kind: 'saveAssignment', body: { ...next.body, done: queued.body.done } };
  }
  return next;
}

/** The queue with a new write added under the rules above. */
/** 按上述规则加入一条新写入之后的队列。 */
export function enqueue(outbox: readonly TimetableOutboxItem[], mutation: TimetableMutation, ctx: EnqueueContext): TimetableOutboxItem[] {
  const key = mutationKey(mutation);
  const item: TimetableOutboxItem = { key, mutation, attempts: 0, queuedAt: ctx.queuedAt, id: ctx.id };

  if (mutation.kind === 'clear') {
    // Everything but the settings is wiped, so earlier writes still waiting no longer matter.
    // 除设置外一切都会被清除，因此仍在等待的较早写入已无意义。
    const kept = outbox.filter((queued) => queued.id === ctx.sendingId || queued.key === 'settings');
    return [...kept, item];
  }

  const index = outbox.findIndex((queued) => queued.key === key && queued.id !== ctx.sendingId);
  const queued = index === -1 ? undefined : outbox[index];

  if (isDelete(mutation)) {
    if (queued?.fresh) {
      const cancelled = cancelFresh([...outbox], index, mutation, ctx);
      if (cancelled) return cancelled;
      // A new term that queued courses still refer to is created and then deleted, so the server cascades it.
      // 仍有排队课程引用的新学期会先创建再删除，由服务器完成级联。
      return [...outbox, item];
    }
    const rest = outbox.filter((existing) => existing.key !== key || existing.id === ctx.sendingId);
    return [...rest, item];
  }

  if (!queued) return [...outbox, { ...item, fresh: !exists(mutation, ctx.before) }];

  const folded = fold(queued.mutation, mutation);
  if (folded === null) return [...outbox, item];
  const deps = dependencies(folded, ctx.before);
  const inOrder = deps.every((dep) => lastIndexOfKey(outbox, dep, index) < index);
  if (!inOrder) return [...outbox, { ...item, mutation: folded }];
  const next = [...outbox];
  // The replacement keeps the first write's place and its queue time, so a replay stamps the same instant.
  // 替换后的写入保留第一次写入的位置与排队时间，因此重放时使用同一时刻。
  next[index] = { ...queued, mutation: folded, attempts: 0, id: ctx.id, queuedAt: ctx.queuedAt };
  return next;
}

/** Ids of terms, courses, meetings and assignments with a queued write, for the 待同步 dot. */
/** 有排队写入的学期、课程、上课时间和作业的 id，用于「待同步」圆点。 */
export function pendingIdsOf(outbox: readonly TimetableOutboxItem[]): Set<string> {
  const ids = new Set<string>();
  for (const { mutation } of outbox) {
    switch (mutation.kind) {
      case 'saveCourse':
        ids.add(mutation.body.id);
        for (const meeting of mutation.body.meetings) ids.add(meeting.id);
        break;
      case 'saveTerm':
      case 'saveAssignment':
        ids.add(mutation.body.id);
        break;
      case 'deleteCourse':
      case 'deleteTerm':
      case 'deleteAssignment':
      case 'setAssignmentDone':
        ids.add(mutation.id);
        break;
      case 'setSkip':
        if (mutation.body.meetingId) ids.add(mutation.body.meetingId);
        break;
      default:
        break;
    }
  }
  return ids;
}

/** Waits before the next try after a network failure or a server error: 2 s, 5 s, 15 s, then every minute. */
/** 网络失败或服务器出错后，下一次尝试前的等待：2 秒、5 秒、15 秒，之后每分钟一次。 */
export const RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 60_000] as const;

export function retryDelayMs(attempts: number): number {
  const index = Math.min(Math.max(attempts, 1), RETRY_DELAYS_MS.length) - 1;
  return RETRY_DELAYS_MS[index] ?? 60_000;
}

/**
 * Whether the server refused the write for good (a 4xx other than a timeout or a rate limit). Network failures,
 * timeouts, rate limits and server errors (5xx, including 503 before migration 0017) are tried again.
 * 服务器是否永久拒绝了这次写入（超时和限流以外的 4xx）。网络失败、超时、限流和服务器错误（5xx，包括迁移 0017 之前的 503）会重试。
 */
export function isPermanentFailure(error: unknown): boolean {
  if (!(error instanceof ApiClientError)) return false;
  return error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429;
}
