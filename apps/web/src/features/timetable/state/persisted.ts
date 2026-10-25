/**
 * Owner: T3, timetable web core. Reads what utmmsc.timetable.v1 holds back into the store, checking the shape of
 * every item, so a damaged or hand-edited entry is dropped instead of breaking the timetable or the home card.
 * 维护者：T3，课表网页核心。把 utmmsc.timetable.v1 中保存的内容读回 store，并检查每一项的结构，
 * 使损坏或被手动修改的记录被丢弃，而不会弄坏课表或首页卡片。
 */
import {
  ASSIGNMENT_OFFSETS,
  CLASS_LEADS,
  COURSE_COLORS,
  DEFAULT_TIMETABLE_SETTINGS,
  isTimetableDate,
  MEETING_KINDS,
  WEEK_RULES,
  type TimetableAssignment,
  type TimetableCourse,
  type TimetableMeeting,
  type TimetableResponse,
  type TimetableSettings,
  type TimetableSkip,
  type TimetableTerm,
} from '@utmmsc/shared';
import { dueMsOf } from '../model/formatDue';
import type { PersistedTimetable, TimetableMutation, TimetableOutboxItem } from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isString = (value: unknown): value is string => typeof value === 'string';
const isNullableString = (value: unknown): value is string | null => value === null || typeof value === 'string';
const isInt = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value);
const isIntList = (value: unknown): value is number[] => Array.isArray(value) && value.every(isInt);

function oneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === 'string' && (options as readonly string[]).includes(value);
}

function isMeeting(value: unknown): value is TimetableMeeting {
  return (
    isRecord(value) &&
    isString(value.id) &&
    oneOf(value.kind, MEETING_KINDS) &&
    isNullableString(value.section) &&
    isInt(value.weekday) &&
    value.weekday >= 1 &&
    value.weekday <= 7 &&
    isInt(value.startMin) &&
    isInt(value.endMin) &&
    value.endMin > value.startMin &&
    isNullableString(value.location) &&
    oneOf(value.weekRule, WEEK_RULES) &&
    (value.weekList === null || isIntList(value.weekList))
  );
}

function isCourse(value: unknown): value is TimetableCourse {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isNullableString(value.termId) &&
    isString(value.code) &&
    isNullableString(value.title) &&
    oneOf(value.color, COURSE_COLORS) &&
    isNullableString(value.notes) &&
    typeof value.remind === 'boolean' &&
    Array.isArray(value.meetings) &&
    value.meetings.every(isMeeting) &&
    isString(value.updatedAt)
  );
}

// Term and skip dates are checked as the server checks them, since the week grid reads them with calendar helpers
// that throw on a date that is not real.
// 学期和停课日期按服务器的方式检查，因为周课表用日历工具读取它们，而这些工具遇到不真实的日期会抛出异常。
function isTerm(value: unknown): value is TimetableTerm {
  return isRecord(value) && isString(value.id) && isString(value.name) && isTimetableDate(value.startsOn) && isTimetableDate(value.endsOn) && isIntList(value.skipWeeks) && isString(value.updatedAt);
}

function isSkip(value: unknown): value is TimetableSkip {
  return isRecord(value) && isTimetableDate(value.onDate) && isNullableString(value.meetingId) && isNullableString(value.label);
}

function isAssignment(value: unknown): value is TimetableAssignment {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isNullableString(value.courseId) &&
    isString(value.title) &&
    isNullableString(value.notes) &&
    isString(value.dueAt) &&
    dueMsOf(value.dueAt) !== null &&
    Array.isArray(value.remindOffsets) &&
    value.remindOffsets.every((token) => oneOf(token, ASSIGNMENT_OFFSETS)) &&
    isNullableString(value.doneAt) &&
    isString(value.updatedAt)
  );
}

function cleanSettings(value: unknown): TimetableSettings {
  const base: TimetableSettings = { ...DEFAULT_TIMETABLE_SETTINGS, assignmentOffsets: [...DEFAULT_TIMETABLE_SETTINGS.assignmentOffsets] };
  if (!isRecord(value)) return base;
  return {
    classReminders: typeof value.classReminders === 'boolean' ? value.classReminders : base.classReminders,
    classLeadMin: (CLASS_LEADS as readonly unknown[]).includes(value.classLeadMin) ? (value.classLeadMin as TimetableSettings['classLeadMin']) : base.classLeadMin,
    assignmentOffsets:
      Array.isArray(value.assignmentOffsets) && value.assignmentOffsets.every((token) => oneOf(token, ASSIGNMENT_OFFSETS))
        ? (value.assignmentOffsets as TimetableSettings['assignmentOffsets'])
        : base.assignmentOffsets,
    showWeekend: value.showWeekend === 'auto' ? 'auto' : 'always',
    locale: value.locale === 'en' ? 'en' : 'zh',
  };
}

/** A stored snapshot with every broken item left out, or null when it is not a snapshot at all. */
/** 去掉所有损坏条目后的已存快照；根本不是快照时为 null。 */
export function cleanSnapshot(value: unknown): TimetableResponse | null {
  if (!isRecord(value) || !isInt(value.rev) || value.rev < 0) return null;
  const list = <T>(items: unknown, check: (item: unknown) => item is T): T[] => (Array.isArray(items) ? items.filter(check) : []);
  return {
    rev: value.rev,
    remindersAllowed: value.remindersAllowed !== false,
    settings: cleanSettings(value.settings),
    terms: list(value.terms, isTerm),
    courses: list(value.courses, isCourse),
    skips: list(value.skips, isSkip),
    assignments: list(value.assignments, isAssignment),
  };
}

const MUTATION_KINDS: readonly TimetableMutation['kind'][] = [
  'saveCourse',
  'deleteCourse',
  'saveTerm',
  'deleteTerm',
  'saveAssignment',
  'setAssignmentDone',
  'deleteAssignment',
  'setSkip',
  'updateSettings',
  'clear',
];

/**
 * A queued write is kept when its kind is known and its body has the fields its kind needs; the server checks the
 * rest and refuses anything else, which then drops it.
 * 已知类型、且请求体具备该类型所需字段的排队写入会被保留；其余内容由服务器检查，被拒绝的写入随后会被丢弃。
 */
function isMutation(value: unknown): value is TimetableMutation {
  if (!isRecord(value) || !oneOf(value.kind, MUTATION_KINDS)) return false;
  switch (value.kind) {
    case 'saveCourse':
      return isRecord(value.body) && isString(value.body.id) && Array.isArray(value.body.meetings) && value.body.meetings.every(isMeeting);
    case 'saveTerm':
      // Term, skip and due dates are checked like the snapshot's, since a queued write reaches the screens through
      // the optimistic copy.
      // 学期、停课和截止日期与快照中的一样要检查，因为排队的写入会经由乐观更新的副本出现在页面上。
      return isRecord(value.body) && isString(value.body.id) && isTimetableDate(value.body.startsOn) && isTimetableDate(value.body.endsOn) && isIntList(value.body.skipWeeks);
    case 'saveAssignment':
      return isRecord(value.body) && isString(value.body.id) && isString(value.body.dueAt) && dueMsOf(value.body.dueAt) !== null && Array.isArray(value.body.remindOffsets);
    case 'setSkip':
      return isRecord(value.body) && isTimetableDate(value.body.onDate) && isNullableString(value.body.meetingId) && typeof value.body.skipped === 'boolean';
    case 'setAssignmentDone':
      return isString(value.id) && typeof value.done === 'boolean';
    case 'deleteCourse':
    case 'deleteTerm':
    case 'deleteAssignment':
      return isString(value.id);
    case 'updateSettings':
      return isRecord(value.patch);
    case 'clear':
      return true;
    default:
      return false;
  }
}

function cleanOutbox(value: unknown): TimetableOutboxItem[] {
  if (!Array.isArray(value)) return [];
  const out: TimetableOutboxItem[] = [];
  for (const item of value) {
    if (!isRecord(item) || !isString(item.key) || !isMutation(item.mutation)) continue;
    out.push({
      key: item.key,
      mutation: item.mutation,
      attempts: isInt(item.attempts) && item.attempts >= 0 ? item.attempts : 0,
      queuedAt: typeof item.queuedAt === 'number' && Number.isFinite(item.queuedAt) ? item.queuedAt : 0,
      ...(isString(item.id) ? { id: item.id } : {}),
      ...(item.fresh === true ? { fresh: true } : {}),
    });
  }
  return out;
}

/** The stored state checked field by field; anything unreadable starts empty. */
/** 逐字段检查的已存状态；无法读取的部分从空开始。 */
export function cleanPersisted(value: unknown): PersistedTimetable {
  if (!isRecord(value)) return { memberId: null, snapshot: null, outbox: [], dismissedEmpty: false };
  return {
    memberId: isString(value.memberId) ? value.memberId : null,
    snapshot: cleanSnapshot(value.snapshot),
    outbox: cleanOutbox(value.outbox),
    dismissedEmpty: value.dismissedEmpty === true,
  };
}
