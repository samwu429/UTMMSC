/**
 * A small timetable for the tests: a Fall term with reading week (week 7), a course with weekly, odd-week and
 * custom-week meetings, a term-less course, a holiday, a single skip, and one open and one done assignment.
 * 测试用的小课表：一个有阅读周（第 7 周）的秋季学期，一门有每周、单周和自定义周次上课时间的课程，一门不属于学期的课程，
 * 一个假日、一次单次停课，以及一项未完成和一项已完成的作业。
 */
import type { TimetableAssignment, TimetableCourse, TimetableSkip, TimetableTerm } from '@utmmsc/shared';

/** 2026-10-24 12:00 Toronto (EDT). */
/** 多伦多时间 2026-10-24 12:00（夏令时）。 */
export const NOW = Date.UTC(2026, 9, 24, 16, 0);

const id = (prefix: string, n: number) => `${prefix}_${String(n).padStart(22, 'A')}`;

export const fall: TimetableTerm = { id: id('tt', 1), name: '2026 秋季', startsOn: '2026-09-03', endsOn: '2026-12-03', skipWeeks: [7], updatedAt: '' };

export const courses: TimetableCourse[] = [
  {
    id: id('tc', 1), termId: fall.id, code: 'MAT102H5F', title: 'Intro to Mathematical Proofs', color: 'blue', notes: 'Bring; notes, please', remind: true, updatedAt: '',
    meetings: [
      { id: id('tm', 1), kind: 'lec', section: 'LEC0101', weekday: 1, startMin: 600, endMin: 650, location: 'DV 2074', weekRule: 'all', weekList: null },
      { id: id('tm', 2), kind: 'tut', section: 'TUT0103', weekday: 4, startMin: 780, endMin: 840, location: 'IB 110', weekRule: 'odd', weekList: null },
      { id: id('tm', 3), kind: 'pra', section: null, weekday: 3, startMin: 840, endMin: 960, location: null, weekRule: 'list', weekList: [2, 5, 9] },
    ],
  },
  {
    id: id('tc', 2), termId: null, code: '合唱团', title: null, color: 'gold', notes: null, remind: false, updatedAt: '',
    meetings: [{ id: id('tm', 4), kind: 'other', section: null, weekday: 5, startMin: 1140, endMin: 1260, location: 'Student Centre', weekRule: 'all', weekList: null }],
  },
];

export const skips: TimetableSkip[] = [
  { onDate: '2026-10-12', meetingId: null, label: 'Thanksgiving' },
  { onDate: '2026-11-05', meetingId: id('tm', 2), label: null },
  { onDate: '2026-11-06', meetingId: null, label: null },
];

export const assignments: TimetableAssignment[] = [
  { id: id('ta', 1), courseId: id('tc', 1), title: 'PS3', notes: null, dueAt: '2026-10-31T03:59:00.000Z', remindOffsets: ['1d', 'morning', '1h'], doneAt: null, updatedAt: '' },
  { id: id('ta', 2), courseId: null, title: 'Done thing', notes: null, dueAt: '2026-10-29T03:59:00.000Z', remindOffsets: [], doneAt: '2026-10-25T00:00:00.000Z', updatedAt: '' },
];

export const fixture = { terms: [fall], courses, skips, assignments };
