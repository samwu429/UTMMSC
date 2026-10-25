import { describe, expect, it } from 'vitest';
import {
  assignmentLine,
  endAfterStartChange,
  endTimeOptions,
  fileProblemText,
  ignoredText,
  importButtonText,
  importDoneText,
  importProblemText,
  meetingLine,
  meetingProblemText,
  planIsEmpty,
  readCalendarText,
  startTimeOptions,
  termLine,
} from './importCopy';
import type { ImportMeetingDraft } from './plan';
import { NOW } from './fixtures.testdata';
import { GOOGLE_ICS } from './samples.testdata';

const meeting: ImportMeetingDraft = {
  id: 'tm_0000000000000000000001',
  weekday: 2,
  startMin: 600,
  endMin: 660,
  problem: null,
  suggestedStart: 600,
  suggestedEnd: 660,
  kind: 'lec',
  section: 'LEC0101',
  location: 'DV 2074',
  weekRule: 'all',
  weekList: null,
  skipDates: ['2026-11-03'],
};

describe('readCalendarText', () => {
  it('reads a calendar, refuses other text, and reports a calendar with no events', () => {
    const read = readCalendarText(GOOGLE_ICS);
    expect(read.ok && read.calendar.events.length).toBe(9);
    expect(readCalendarText('hello')).toEqual({ ok: false, problem: 'not_calendar' });
    expect(readCalendarText('BEGIN:VCALENDAR\r\nEND:VCALENDAR')).toEqual({ ok: false, problem: 'nothing' });
  });

  it('knows an empty plan', () => {
    expect(planIsEmpty({ terms: [], courses: [], assignments: [], ignored: { repeating: 1, allDay: 0, noEnd: 0, past: 0 } })).toBe(true);
  });

  it('explains every file problem in both languages', () => {
    for (const problem of ['too_large', 'not_calendar', 'nothing', 'unreadable'] as const) {
      expect(fileProblemText(problem, 'zh')).toMatch(/[一-鿿]/);
      expect(fileProblemText(problem, 'en')).toMatch(/^[A-Z]/);
    }
  });
});

describe('preview lines', () => {
  it('describes a term with its reading week', () => {
    expect(termLine({ startsOn: '2026-09-08', endsOn: '2026-12-01', skipWeeks: [6] }, 'zh')).toBe('9/8–12/1 · 13 周 · 第 6 周不上课');
    expect(termLine({ startsOn: '2026-09-08', endsOn: '2026-12-01', skipWeeks: [] }, 'en')).toBe('Sep 8–Dec 1 · 13 weeks');
  });

  it('describes a class with its time, place, kind, weeks and skips', () => {
    expect(meetingLine(meeting, 600, 660, 'zh')).toBe('周二 10:00–11:00 · DV 2074 · 讲座 LEC0101 · 每周 · 停课 1 次');
    expect(meetingLine({ ...meeting, location: null, section: null, skipDates: [], weekRule: 'odd' }, 780, 870, 'en')).toBe('Tue 1:00–2:30 PM · Lecture · Odd weeks');
    // A time from the file past midnight still reads as a clock.
    // 文件中超过午夜的时间仍按时钟显示。
    expect(meetingLine({ ...meeting, skipDates: [] }, 1380, 1500, 'zh')).toBe('周二 23:00–01:00 · DV 2074 · 讲座 LEC0101 · 每周');
  });

  it('says why a time must change', () => {
    expect(meetingProblemText('invalid_meeting_time', 'zh')).toBe('时间要在 09:00–21:00 之间');
    expect(meetingProblemText('meeting_too_short', 'en')).toBe('Must end at least 10 minutes after it starts');
  });

  it('describes a deadline with its course', () => {
    expect(assignmentLine({ courseCode: 'MAT102', dueAt: '2026-10-31T03:59:00.000Z' }, NOW, 'zh')).toBe('MAT102 · 周五 23:59');
    expect(assignmentLine({ courseCode: null, dueAt: '2026-10-25T03:59:00.000Z' }, NOW, 'en')).toBe('Today 11:59 PM');
  });

  it('sums up what was left out', () => {
    expect(ignoredText({ repeating: 0, allDay: 0, noEnd: 0, past: 0 }, 'zh')).toBeNull();
    expect(ignoredText({ repeating: 1, allDay: 0, noEnd: 0, past: 2 }, 'zh')).toBe('另有 3 个事件无法导入：1 个不是每周重复，2 个已经过去或太远。');
    expect(ignoredText({ repeating: 0, allDay: 1, noEnd: 1, past: 0 }, 'en')).toBe("2 more events can't be imported: 1 is all-day, 1 repeats every few weeks with no end.");
  });
});

describe('import button and problems', () => {
  it('counts what will be imported', () => {
    expect(importButtonText({ courses: 2, assignments: 3 }, 'zh')).toBe('导入 2 门课程、3 项作业');
    expect(importButtonText({ courses: 1, assignments: 0 }, 'en')).toBe('Import 1 course');
    expect(importButtonText({ courses: 0, assignments: 0 }, 'zh')).toBe('请选择要导入的内容');
    expect(importDoneText({ courses: 2, assignments: 1 }, 'zh')).toBe('已导入 2 门课程、1 项作业');
    expect(importDoneText({ courses: 0, assignments: 2 }, 'en')).toBe('Imported 2 assignments');
  });

  it('explains every problem', () => {
    expect(importProblemText({ kind: 'course_code', code: '' }, 'zh')).toBe('课程代码需要 1 到 20 个字符');
    expect(importProblemText({ kind: 'course_code', code: 'X'.repeat(21) }, 'en')).toBe(`Course codes need 1 to 20 characters: ${'X'.repeat(21)}`);
    expect(importProblemText({ kind: 'meeting_time', code: 'PHY136' }, 'zh')).toBe('PHY136 有上课时间不在 09:00–21:00 之间');
    expect(importProblemText({ kind: 'too_many_courses', max: 30 }, 'zh')).toBe('最多 30 门课程');
    expect(importProblemText({ kind: 'term_name' }, 'en')).toBe('Enter a name for each new term');
  });
});

describe('time choices', () => {
  it('offers every allowed start and end', () => {
    const starts = startTimeOptions();
    expect(starts[0]).toBe(540);
    expect(starts[starts.length - 1]).toBe(1250);
    expect(starts).toHaveLength(143);
    expect(endTimeOptions(1250)).toEqual([1260]);
    expect(endTimeOptions(600).slice(0, 2)).toEqual([610, 615]);
  });

  it('keeps the length when the start moves, within the day', () => {
    expect(endAfterStartChange(1140, 1260, 600)).toBe(720);
    expect(endAfterStartChange(600, 720, 1200)).toBe(1260);
    expect(endAfterStartChange(600, 605, 900)).toBe(910);
  });
});
