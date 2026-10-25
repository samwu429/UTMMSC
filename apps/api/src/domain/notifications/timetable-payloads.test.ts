import { describe, expect, it } from 'vitest';
import { wallTimeToUtcMs } from '@utmmsc/shared';
import {
  TIMETABLE_CLASS_TAG,
  assignmentReminderPayload,
  classReminderPayload,
  formatDueTime,
  formatTimeLeft,
  timetableClassUrl,
  timetableDueTag,
  timetableDueUrl,
  type AssignmentReminderItem,
  type ClassReminderItem,
} from './timetable-payloads';

const BASE = 'https://utmmsc.com/UTMMSC/';
const MIN = 60_000;
const HOUR = 60 * MIN;
const toronto = (y: number, m: number, d: number, h: number, min: number) => wallTimeToUtcMs(y, m, d, h, min, 'America/Toronto');

const MEETING = 'tm_AAAAAAAAAAAAAAAAAAAAAA';
const OTHER_MEETING = 'tm_BBBBBBBBBBBBBBBBBBBBBB';
const TEN = toronto(2026, 10, 26, 10, 0);

const mat102: ClassReminderItem = {
  meetingId: MEETING,
  code: 'MAT102H5F',
  kind: 'lec',
  location: 'DV 2074',
  startMin: 600,
  endMin: 650,
  onDate: '2026-10-26',
  startMs: TEN,
};
const csc108: ClassReminderItem = { ...mat102, meetingId: OTHER_MEETING, code: 'CSC108H5F', kind: 'tut', location: 'IB 110' };

describe('classReminderPayload', () => {
  it('names one class, its time, room and kind, in Chinese', () => {
    expect(classReminderPayload({ classes: [mat102], locale: 'zh', preview: true, nowMs: TEN - 10 * MIN, baseUrl: BASE })).toEqual({
      title: 'MAT102 · 10 分钟后上课',
      body: '10:00–10:50 · DV 2074 · 讲座',
      tag: 'tt:class',
      url: `https://utmmsc.com/UTMMSC/timetable?date=2026-10-26&focus=${MEETING}`,
      kind: 'class',
      ttlSeconds: 600,
    });
  });

  it('writes the same in English with a 12-hour clock', () => {
    const payload = classReminderPayload({ classes: [mat102], locale: 'en', preview: true, nowMs: TEN - 10 * MIN, baseUrl: BASE });
    expect(payload.title).toBe('MAT102 · class in 10 min');
    expect(payload.body).toBe('10:00–10:50 AM · DV 2074 · Lecture');
  });

  it('states the real minutes left after a late run, and keeps the push only until class starts', () => {
    const payload = classReminderPayload({ classes: [mat102], locale: 'zh', preview: true, nowMs: TEN - 8 * MIN, baseUrl: BASE });
    expect(payload.title).toBe('MAT102 · 8 分钟后上课');
    expect(payload.ttlSeconds).toBe(480);
    const seconds = classReminderPayload({ classes: [mat102], locale: 'zh', preview: true, nowMs: TEN - 10 * MIN + 25_000, baseUrl: BASE });
    expect(seconds.title).toBe('MAT102 · 10 分钟后上课');
    expect(seconds.ttlSeconds).toBe(575);
  });

  it('leaves out a missing room and the kind other', () => {
    const payload = classReminderPayload({ classes: [{ ...mat102, location: null, kind: 'other' }], locale: 'zh', preview: true, nowMs: TEN - 10 * MIN, baseUrl: BASE });
    expect(payload.body).toBe('10:00–10:50');
    const lab = classReminderPayload({ classes: [{ ...mat102, location: '  ', kind: 'lab', startMin: 690, endMin: 770 }], locale: 'en', preview: true, nowMs: TEN - 10 * MIN, baseUrl: BASE });
    expect(lab.body).toBe('11:30 AM–12:50 PM · Lab');
  });

  it('merges classes starting together into one push', () => {
    const zh = classReminderPayload({ classes: [mat102, csc108], locale: 'zh', preview: true, nowMs: TEN - 10 * MIN, baseUrl: BASE });
    expect(zh.title).toBe('10 分钟后有 2 节课');
    expect(zh.body).toBe('CSC108 IB 110；MAT102 DV 2074');
    expect(zh.tag).toBe(TIMETABLE_CLASS_TAG);
    const en = classReminderPayload({ classes: [mat102, csc108], locale: 'en', preview: true, nowMs: TEN - 10 * MIN, baseUrl: BASE });
    expect(en.title).toBe('2 classes in 10 min');
    expect(en.body).toBe('CSC108 IB 110; MAT102 DV 2074');
  });

  it('adds each start time when merged classes start at different times, and opens the first', () => {
    const later = { ...csc108, startMin: 605, endMin: 655, startMs: TEN + 5 * MIN };
    const zh = classReminderPayload({ classes: [later, mat102], locale: 'zh', preview: true, nowMs: TEN - 4 * MIN, baseUrl: BASE });
    expect(zh.title).toBe('2 节课快开始了');
    expect(zh.body).toBe('MAT102 10:00 DV 2074；CSC108 10:05 IB 110');
    expect(zh.url).toContain(`focus=${MEETING}`);
    expect(zh.ttlSeconds).toBe(240);
    const en = classReminderPayload({ classes: [later, mat102], locale: 'en', preview: true, nowMs: TEN - 4 * MIN, baseUrl: BASE });
    expect(en.title).toBe('2 classes starting soon');
    expect(en.body).toBe('MAT102 10:00 AM DV 2074; CSC108 10:05 AM IB 110');
  });

  it('shows no code, room or time when preview is off', () => {
    const zh = classReminderPayload({ classes: [mat102, csc108], locale: 'zh', preview: false, nowMs: TEN - 10 * MIN, baseUrl: BASE });
    expect(zh).toMatchObject({ title: 'UTMMSC', body: '10 分钟后有课', tag: 'tt:class', kind: 'class', ttlSeconds: 600 });
    expect(classReminderPayload({ classes: [mat102], locale: 'en', preview: false, nowMs: TEN - 10 * MIN, baseUrl: BASE }).body).toBe('A class starts in 10 min');
    expect(classReminderPayload({ classes: [mat102, csc108], locale: 'en', preview: false, nowMs: TEN - 10 * MIN, baseUrl: BASE }).body).toBe('Classes start in 10 min');
  });

  it('shows the short code, or the first eight characters of a code that is not UofT style', () => {
    const payload = classReminderPayload({ classes: [{ ...mat102, code: 'WRITING STUDIO' }], locale: 'zh', preview: true, nowMs: TEN - 10 * MIN, baseUrl: BASE });
    expect(payload.title).toBe('WRITING · 10 分钟后上课');
  });

  it('refuses an empty list', () => {
    expect(() => classReminderPayload({ classes: [], locale: 'zh', preview: true, nowMs: TEN, baseUrl: BASE })).toThrow(RangeError);
  });
});

const ASSIGNMENT = 'ta_AAAAAAAAAAAAAAAAAAAAAA';
const OTHER_ASSIGNMENT = 'ta_BBBBBBBBBBBBBBBBBBBBBB';
// Tuesday 2026-10-27 23:59 EDT.
const DUE = toronto(2026, 10, 27, 23, 59);
const ps3: AssignmentReminderItem = { assignmentId: ASSIGNMENT, title: 'PS3', courseCode: 'MAT102H5F', dueMs: DUE };

describe('assignmentReminderPayload', () => {
  it('names one assignment with its course, due time and time left', () => {
    expect(assignmentReminderPayload({ assignments: [ps3], locale: 'zh', preview: true, nowMs: DUE - 24 * HOUR, baseUrl: BASE })).toEqual({
      title: '作业截止提醒 · PS3',
      body: 'MAT102 · 明天 23:59 截止（还有 1 天）',
      tag: `tt:due:${ASSIGNMENT}`,
      url: `https://utmmsc.com/UTMMSC/timetable/due?focus=${ASSIGNMENT}`,
      kind: 'assignment',
      ttlSeconds: 12 * 60 * 60,
    });
    const en = assignmentReminderPayload({ assignments: [ps3], locale: 'en', preview: true, nowMs: DUE - 24 * HOUR, baseUrl: BASE });
    expect(en.title).toBe('Assignment due · PS3');
    expect(en.body).toBe('MAT102 · due tomorrow 11:59 PM (in 1 day)');
  });

  it('keeps the push until the deadline when that is under 12 hours away', () => {
    const payload = assignmentReminderPayload({ assignments: [ps3], locale: 'zh', preview: true, nowMs: DUE - HOUR, baseUrl: BASE });
    expect(payload.body).toBe('MAT102 · 今天 23:59 截止（还有 1 小时）');
    expect(payload.ttlSeconds).toBe(3600);
  });

  it('says 1 day across the November change, where the day before is 25 hours', () => {
    // Due Sunday 2026-11-01 23:59 EST; its 1d reminder is Saturday 23:59 EDT, 25 hours earlier.
    const due = toronto(2026, 11, 1, 23, 59);
    const sendAt = toronto(2026, 10, 31, 23, 59);
    expect(due - sendAt).toBe(25 * HOUR);
    const payload = assignmentReminderPayload({ assignments: [{ ...ps3, dueMs: due }], locale: 'zh', preview: true, nowMs: sendAt, baseUrl: BASE });
    expect(payload.body).toBe('MAT102 · 明天 23:59 截止（还有 1 天）');
  });

  it('leaves out the course of an assignment without one', () => {
    const payload = assignmentReminderPayload({ assignments: [{ ...ps3, courseCode: null }], locale: 'en', preview: true, nowMs: DUE - 3 * HOUR, baseUrl: BASE });
    expect(payload.body).toBe('due today 11:59 PM (in 3 hours)');
  });

  it('merges several assignments into one push under one tag', () => {
    const lab = { assignmentId: OTHER_ASSIGNMENT, title: 'Lab 4', courseCode: null, dueMs: toronto(2026, 10, 28, 17, 0) };
    const nowMs = toronto(2026, 10, 27, 20, 59);
    const zh = assignmentReminderPayload({ assignments: [lab, ps3], locale: 'zh', preview: true, nowMs, baseUrl: BASE });
    expect(zh).toMatchObject({ title: '2 项作业快截止了', body: 'PS3 23:59；Lab 4 明天 17:00', tag: 'tt:due', url: 'https://utmmsc.com/UTMMSC/timetable/due', ttlSeconds: 3 * 3600 });
    const en = assignmentReminderPayload({ assignments: [lab, ps3], locale: 'en', preview: true, nowMs, baseUrl: BASE });
    expect(en.title).toBe('2 assignments due soon');
    expect(en.body).toBe('PS3 11:59 PM; Lab 4 tomorrow 5:00 PM');
  });

  it('shows no title or course when preview is off', () => {
    expect(assignmentReminderPayload({ assignments: [ps3], locale: 'zh', preview: false, nowMs: DUE - HOUR, baseUrl: BASE })).toMatchObject({
      title: 'UTMMSC',
      body: '你有一项作业快截止了',
      tag: `tt:due:${ASSIGNMENT}`,
    });
    expect(assignmentReminderPayload({ assignments: [ps3], locale: 'en', preview: false, nowMs: DUE - HOUR, baseUrl: BASE }).body).toBe('An assignment is due soon');
    const two = [ps3, { ...ps3, assignmentId: OTHER_ASSIGNMENT }];
    expect(assignmentReminderPayload({ assignments: two, locale: 'zh', preview: false, nowMs: DUE - HOUR, baseUrl: BASE }).body).toBe('你有 2 项作业快截止了');
    expect(assignmentReminderPayload({ assignments: two, locale: 'en', preview: false, nowMs: DUE - HOUR, baseUrl: BASE }).body).toBe('2 assignments are due soon');
  });

  it('caps a long title without splitting a character', () => {
    const emoji = String.fromCodePoint(0x1f4da);
    const payload = assignmentReminderPayload({ assignments: [{ ...ps3, title: emoji.repeat(120) }], locale: 'zh', preview: true, nowMs: DUE - HOUR, baseUrl: BASE });
    const chars = Array.from(payload.title);
    expect(chars.length).toBe(70);
    expect(chars[chars.length - 1]).toBe('…');
    expect(chars[chars.length - 2]).toBe(emoji);
  });

  it('refuses an empty list', () => {
    expect(() => assignmentReminderPayload({ assignments: [], locale: 'zh', preview: true, nowMs: DUE, baseUrl: BASE })).toThrow(RangeError);
  });
});

describe('formatDueTime', () => {
  const now = toronto(2026, 10, 26, 9, 0); // Monday

  it('names today, tomorrow, the day after, the weekday within a week, then the date', () => {
    const at = (d: number) => toronto(2026, 10, d, 17, 0);
    expect([at(26), at(27), at(28), at(29), toronto(2026, 11, 2, 17, 0)].map((ms) => formatDueTime(ms, now, 'zh'))).toEqual([
      '今天 17:00',
      '明天 17:00',
      '后天 17:00',
      '周四 17:00',
      '11月2日 17:00',
    ]);
    expect([at(26), at(27), at(28), at(29), toronto(2026, 11, 2, 17, 0)].map((ms) => formatDueTime(ms, now, 'en'))).toEqual([
      'today 5:00 PM',
      'tomorrow 5:00 PM',
      'Wed 5:00 PM',
      'Thu 5:00 PM',
      'Nov 2, 5:00 PM',
    ]);
  });

  it('writes only the clock for today inside a list', () => {
    expect(formatDueTime(toronto(2026, 10, 26, 23, 59), now, 'zh', true)).toBe('23:59');
    expect(formatDueTime(toronto(2026, 10, 26, 23, 59), now, 'en', true)).toBe('11:59 PM');
  });

  it('uses Toronto dates, not UTC ones', () => {
    // 23:30 EDT on Monday is already Tuesday in UTC.
    expect(formatDueTime(toronto(2026, 10, 26, 23, 30), now, 'zh')).toBe('今天 23:30');
  });
});

describe('formatTimeLeft', () => {
  it('rounds to minutes, hours or days', () => {
    expect([30 * MIN, 59 * MIN + 40_000, 3 * HOUR, 14 * HOUR + 59 * MIN, 22 * HOUR + 20 * MIN, 22 * HOUR + 40 * MIN, 23 * HOUR, 25 * HOUR, 47 * HOUR, 7 * 24 * HOUR].map((ms) => formatTimeLeft(ms, 'zh'))).toEqual([
      '30 分钟',
      '1 小时',
      '3 小时',
      '15 小时',
      '22 小时',
      '1 天',
      '1 天',
      '1 天',
      '2 天',
      '7 天',
    ]);
    expect([30 * MIN, HOUR, 3 * HOUR, 24 * HOUR, 48 * HOUR].map((ms) => formatTimeLeft(ms, 'en'))).toEqual(['30 min', '1 hour', '3 hours', '1 day', '2 days']);
  });

  it('never says less than a minute', () => {
    expect(formatTimeLeft(10_000, 'zh')).toBe('1 分钟');
    expect(formatTimeLeft(-5_000, 'en')).toBe('1 min');
  });
});

describe('timetable push links and tags', () => {
  it('builds app links under the base with or without its trailing slash', () => {
    expect(timetableClassUrl('https://utmmsc.com/UTMMSC', '2026-10-26', MEETING)).toBe(`https://utmmsc.com/UTMMSC/timetable?date=2026-10-26&focus=${MEETING}`);
    expect(timetableDueUrl(BASE)).toBe('https://utmmsc.com/UTMMSC/timetable/due');
    expect(timetableDueUrl(BASE, ASSIGNMENT)).toBe(`https://utmmsc.com/UTMMSC/timetable/due?focus=${ASSIGNMENT}`);
  });

  it('tags one assignment by id and merged ones together', () => {
    expect(timetableDueTag(ASSIGNMENT)).toBe(`tt:due:${ASSIGNMENT}`);
    expect(timetableDueTag(null)).toBe('tt:due');
  });
});
