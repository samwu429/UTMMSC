/**
 * Owner: T3, timetable web core. What screens read from the store: the snapshot with defaults filled in, plus the
 * ids still waiting to sync (待同步).
 * 维护者：T3，课表网页核心。各页面从 store 读取的内容：填好默认值的快照，以及仍在等待同步（待同步）的 id。
 */
import {
  DEFAULT_TIMETABLE_SETTINGS,
  type TimetableAssignment,
  type TimetableCourse,
  type TimetableData,
  type TimetableResponse,
  type TimetableSettings,
  type TimetableSkip,
  type TimetableTerm,
} from '@utmmsc/shared';
import { pendingIdsOf } from './outbox';
import type { TimetableOutboxItem } from './types';

/** What screens read: the snapshot with defaults filled in, plus which items still wait to sync (待同步). */
/** 各页面读取的内容：填好默认值的快照，以及哪些条目仍在等待同步（待同步）。 */
export interface TimetableView extends TimetableData {
  /** A snapshot exists, from this device or the server. */
  /** 已有快照，来自这台设备或服务器。 */
  loaded: boolean;
  rev: number;
  remindersAllowed: boolean;
  settings: TimetableSettings;
  terms: TimetableTerm[];
  courses: TimetableCourse[];
  skips: TimetableSkip[];
  assignments: TimetableAssignment[];
  /** Ids of terms, courses, meetings and assignments with a queued write. */
  /** 有排队写入的学期、课程、上课时间和作业的 id。 */
  pendingIds: ReadonlySet<string>;
}

const NO_PENDING: ReadonlySet<string> = new Set();
const NO_TERMS: TimetableTerm[] = [];
const NO_COURSES: TimetableCourse[] = [];
const NO_SKIPS: TimetableSkip[] = [];
const NO_ASSIGNMENTS: TimetableAssignment[] = [];
const DEFAULT_SETTINGS: TimetableSettings = { ...DEFAULT_TIMETABLE_SETTINGS, assignmentOffsets: [...DEFAULT_TIMETABLE_SETTINGS.assignmentOffsets] };

/**
 * The pending ids as one string, so a selector can tell whether they changed without building a new set each time.
 * 把待同步的 id 拼成一个字符串，选择器无需每次都新建集合就能判断它们是否变化。
 */
export function pendingSignature(outbox: readonly TimetableOutboxItem[]): string {
  if (outbox.length === 0) return '';
  return [...pendingIdsOf(outbox)].sort().join(',');
}

export function pendingFromSignature(signature: string): ReadonlySet<string> {
  return signature === '' ? NO_PENDING : new Set(signature.split(','));
}

export function viewOf(snapshot: TimetableResponse | null, pendingIds: ReadonlySet<string>): TimetableView {
  return {
    loaded: snapshot !== null,
    rev: snapshot?.rev ?? 0,
    remindersAllowed: snapshot?.remindersAllowed ?? true,
    settings: snapshot?.settings ?? DEFAULT_SETTINGS,
    terms: snapshot?.terms ?? NO_TERMS,
    courses: snapshot?.courses ?? NO_COURSES,
    skips: snapshot?.skips ?? NO_SKIPS,
    assignments: snapshot?.assignments ?? NO_ASSIGNMENTS,
    pendingIds,
  };
}
