/**
 * Owner: T3, timetable web core. Builders for the timetable tests: readable, deterministic ids and small terms,
 * courses and assignments with sensible defaults. Only tests import this file.
 * 维护者：T3，课表网页核心。课表测试用的构造函数：可读且固定的 id，以及带合理默认值的学期、课程和作业。只有测试会导入本文件。
 */
import {
  DEFAULT_TIMETABLE_SETTINGS,
  type TimetableAssignment,
  type TimetableCourse,
  type TimetableIdPrefix,
  type TimetableMeeting,
  type TimetableResponse,
  type TimetableTerm,
} from '@utmmsc/shared';

/** A valid id whose tail spells the name, padded to 22 characters: tid('tc', 'mat') is tc_mat________________. */
/** 合法的 id，尾部为名称并补足 22 个字符：tid('tc', 'mat') 为 tc_mat________________。 */
export function tid(prefix: TimetableIdPrefix, name: string): string {
  const tail = name.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 22).padEnd(22, '_');
  return `${prefix}_${tail}`;
}

export const STAMP = '2026-10-01T12:00:00.000Z';

/** Fall 2026: Tuesday 8 Sep to Wednesday 9 Dec, reading week is week 8 (26 Oct - 1 Nov). */
/** 2026 秋季：9 月 8 日（周二）到 12 月 9 日（周三），阅读周为第 8 周（10 月 26 日至 11 月 1 日）。 */
export function term(patch: Partial<TimetableTerm> = {}): TimetableTerm {
  return { id: tid('tt', 'fall'), name: '2026 秋季', startsOn: '2026-09-08', endsOn: '2026-12-09', skipWeeks: [8], updatedAt: STAMP, ...patch };
}

export function meeting(patch: Partial<TimetableMeeting> = {}): TimetableMeeting {
  return { id: tid('tm', 'm1'), kind: 'lec', section: null, weekday: 1, startMin: 600, endMin: 650, location: 'DV 2074', weekRule: 'all', weekList: null, ...patch };
}

export function course(patch: Partial<TimetableCourse> = {}): TimetableCourse {
  return {
    id: tid('tc', 'mat102'),
    termId: null,
    code: 'MAT102H5F',
    title: null,
    color: 'purple',
    notes: null,
    remind: true,
    meetings: [meeting()],
    updatedAt: STAMP,
    ...patch,
  };
}

export function assignment(patch: Partial<TimetableAssignment> = {}): TimetableAssignment {
  return {
    id: tid('ta', 'ps3'),
    courseId: null,
    title: 'PS3',
    notes: null,
    dueAt: '2026-10-30T03:59:00.000Z',
    remindOffsets: ['1d', '1h'],
    doneAt: null,
    updatedAt: STAMP,
    ...patch,
  };
}

export function snapshot(patch: Partial<TimetableResponse> = {}): TimetableResponse {
  return {
    rev: 1,
    remindersAllowed: true,
    settings: { ...DEFAULT_TIMETABLE_SETTINGS, assignmentOffsets: [...DEFAULT_TIMETABLE_SETTINGS.assignmentOffsets] },
    terms: [],
    courses: [],
    skips: [],
    assignments: [],
    ...patch,
  };
}

/** The instant of a Toronto wall time in the autumn of 2026 (EDT until 1 Nov, EST after). */
/** 2026 年秋季某个多伦多本地时间对应的时刻（11 月 1 日前为 EDT，之后为 EST）。 */
export function toronto(date: string, clock: string): number {
  const offset = date >= '2026-11-01' ? '-05:00' : '-04:00';
  return Date.parse(`${date}T${clock}:00${offset}`);
}
