import { describe, expect, it } from 'vitest';
import type { TimetableAssignment, TimetableCourse } from '@utmmsc/shared';
import { ICS_FILE_NAME, ICS_MIME_TYPE, buildTimetableIcs, firstWeekdayFrom } from './build';
import { CRLF } from './ics';
import { NOW, fixture, fall } from './fixtures.testdata';

/**
 * The whole export of the fixture: VTIMEZONE, TZID starts, UNTIL in UTC, EXDATEs for a holiday and reading week,
 * INTERVAL=2 for odd weeks, a custom week list as EXDATEs, a term-less course with no UNTIL, alarms, escaping.
 * 示例数据的完整导出：VTIMEZONE、带 TZID 的开始时间、UTC 的 UNTIL、假日和阅读周的 EXDATE、单周用 INTERVAL=2、自定义周次写成 EXDATE、
 * 不属于学期的课程没有 UNTIL、提醒、转义。
 */
const GOLDEN = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//UTMMSC//Timetable//ZH',
  'CALSCALE:GREGORIAN',
  'METHOD:PUBLISH',
  'X-WR-CALNAME:UTMMSC 课表',
  'X-WR-TIMEZONE:America/Toronto',
  'BEGIN:VTIMEZONE',
  'TZID:America/Toronto',
  'X-LIC-LOCATION:America/Toronto',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:-0500',
  'TZOFFSETTO:-0400',
  'TZNAME:EDT',
  'DTSTART:19700308T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:-0400',
  'TZOFFSETTO:-0500',
  'TZNAME:EST',
  'DTSTART:19701101T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
  'BEGIN:VEVENT',
  'UID:tm_AAAAAAAAAAAAAAAAAAAAA1@utmmsc.com',
  'DTSTAMP:20261024T160000Z',
  'DTSTART;TZID=America/Toronto:20260907T100000',
  'DTEND;TZID=America/Toronto:20260907T105000',
  'RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261204T045959Z',
  'EXDATE;TZID=America/Toronto:20261012T100000',
  'SUMMARY:MAT102H5F 讲座 LEC0101',
  'LOCATION:DV 2074',
  'DESCRIPTION:Intro to Mathematical Proofs\\n\\nBring\\; notes\\, please',
  'X-UTMMSC-ITEM:class',
  'X-UTMMSC-COURSE:tc_AAAAAAAAAAAAAAAAAAAAA1',
  'X-UTMMSC-CODE:MAT102H5F',
  'X-UTMMSC-KIND:lec',
  'X-UTMMSC-COLOR:blue',
  'X-UTMMSC-SECTION:LEC0101',
  'X-UTMMSC-TITLE:Intro to Mathematical Proofs',
  'X-UTMMSC-WEEKS:all',
  'X-UTMMSC-TERM:2026 秋季',
  'X-UTMMSC-TERM-DATES:20260903/20261203',
  'X-UTMMSC-TERM-SKIP:7',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:tm_AAAAAAAAAAAAAAAAAAAAA2@utmmsc.com',
  'DTSTAMP:20261024T160000Z',
  'DTSTART;TZID=America/Toronto:20260903T130000',
  'DTEND;TZID=America/Toronto:20260903T140000',
  'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TH;UNTIL=20261204T045959Z',
  'EXDATE;TZID=America/Toronto:20261015T130000',
  'SUMMARY:MAT102H5F 辅导 TUT0103',
  'LOCATION:IB 110',
  'DESCRIPTION:Intro to Mathematical Proofs\\n\\nBring\\; notes\\, please',
  'X-UTMMSC-ITEM:class',
  'X-UTMMSC-COURSE:tc_AAAAAAAAAAAAAAAAAAAAA1',
  'X-UTMMSC-CODE:MAT102H5F',
  'X-UTMMSC-KIND:tut',
  'X-UTMMSC-COLOR:blue',
  'X-UTMMSC-SECTION:TUT0103',
  'X-UTMMSC-TITLE:Intro to Mathematical Proofs',
  'X-UTMMSC-WEEKS:odd',
  'X-UTMMSC-TERM:2026 秋季',
  'X-UTMMSC-TERM-DATES:20260903/20261203',
  'X-UTMMSC-TERM-SKIP:7',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:tm_AAAAAAAAAAAAAAAAAAAAA3@utmmsc.com',
  'DTSTAMP:20261024T160000Z',
  'DTSTART;TZID=America/Toronto:20260909T140000',
  'DTEND;TZID=America/Toronto:20260909T160000',
  'RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20261204T045959Z',
  'EXDATE;TZID=America/Toronto:20260916T140000',
  'EXDATE;TZID=America/Toronto:20260923T140000',
  'EXDATE;TZID=America/Toronto:20261007T140000',
  'EXDATE;TZID=America/Toronto:20261014T140000',
  'EXDATE;TZID=America/Toronto:20261021T140000',
  'EXDATE;TZID=America/Toronto:20261104T140000',
  'EXDATE;TZID=America/Toronto:20261111T140000',
  'EXDATE;TZID=America/Toronto:20261118T140000',
  'EXDATE;TZID=America/Toronto:20261125T140000',
  'EXDATE;TZID=America/Toronto:20261202T140000',
  'SUMMARY:MAT102H5F 实践',
  'DESCRIPTION:Intro to Mathematical Proofs\\n\\nBring\\; notes\\, please',
  'X-UTMMSC-ITEM:class',
  'X-UTMMSC-COURSE:tc_AAAAAAAAAAAAAAAAAAAAA1',
  'X-UTMMSC-CODE:MAT102H5F',
  'X-UTMMSC-KIND:pra',
  'X-UTMMSC-COLOR:blue',
  'X-UTMMSC-TITLE:Intro to Mathematical Proofs',
  'X-UTMMSC-WEEKS:list 2 5 9',
  'X-UTMMSC-TERM:2026 秋季',
  'X-UTMMSC-TERM-DATES:20260903/20261203',
  'X-UTMMSC-TERM-SKIP:7',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:tm_AAAAAAAAAAAAAAAAAAAAA4@utmmsc.com',
  'DTSTAMP:20261024T160000Z',
  'DTSTART;TZID=America/Toronto:20261023T190000',
  'DTEND;TZID=America/Toronto:20261023T210000',
  'RRULE:FREQ=WEEKLY;BYDAY=FR',
  'EXDATE;TZID=America/Toronto:20261106T190000',
  'SUMMARY:合唱团',
  'LOCATION:Student Centre',
  'X-UTMMSC-ITEM:class',
  'X-UTMMSC-COURSE:tc_AAAAAAAAAAAAAAAAAAAAA2',
  'X-UTMMSC-CODE:合唱团',
  'X-UTMMSC-KIND:other',
  'X-UTMMSC-COLOR:gold',
  'X-UTMMSC-WEEKS:all',
  'X-UTMMSC-REMIND:0',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:ta_AAAAAAAAAAAAAAAAAAAAA1@utmmsc.com',
  'DTSTAMP:20261024T160000Z',
  'DTSTART;TZID=America/Toronto:20261030T235900',
  'DTEND;TZID=America/Toronto:20261030T235900',
  'SUMMARY:PS3 · MAT102',
  'X-UTMMSC-ITEM:assignment',
  'X-UTMMSC-TITLE:PS3',
  'X-UTMMSC-COURSE:tc_AAAAAAAAAAAAAAAAAAAAA1',
  'X-UTMMSC-OFFSETS:1d morning 1h',
  'BEGIN:VALARM',
  'ACTION:DISPLAY',
  'DESCRIPTION:PS3',
  'TRIGGER:-P1D',
  'END:VALARM',
  'BEGIN:VALARM',
  'ACTION:DISPLAY',
  'DESCRIPTION:PS3',
  'TRIGGER;VALUE=DATE-TIME:20261030T130000Z',
  'END:VALARM',
  'BEGIN:VALARM',
  'ACTION:DISPLAY',
  'DESCRIPTION:PS3',
  'TRIGGER:-PT1H',
  'END:VALARM',
  'END:VEVENT',
  'END:VCALENDAR',
];

function octets(text: string): number {
  return new TextEncoder().encode(text).length;
}

describe('buildTimetableIcs', () => {
  it('matches the golden file', () => {
    expect(buildTimetableIcs(fixture, { nowMs: NOW, locale: 'zh' })).toBe(GOLDEN.join(CRLF) + CRLF);
  });

  it('ends every line in CRLF and folds at 75 octets', () => {
    const long: TimetableCourse = {
      ...fixture.courses[0]!,
      id: 'tc_LONGLONGLONGLONGLONGLO',
      notes: `${'很长的备注'.repeat(30)}, with commas; and semicolons`,
      meetings: [fixture.courses[0]!.meetings[0]!],
    };
    const text = buildTimetableIcs({ ...fixture, courses: [long] }, { nowMs: NOW, locale: 'en' });
    expect(text.endsWith(CRLF)).toBe(true);
    expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    const lines = text.split(CRLF).slice(0, -1);
    for (const line of lines) expect(octets(line)).toBeLessThanOrEqual(75);
    expect(lines.some((line) => line.startsWith(' '))).toBe(true);
    expect(text).toContain('SUMMARY:MAT102H5F Lecture LEC0101');
    expect(text).toContain('PRODID:-//UTMMSC//Timetable//EN');
  });

  it('leaves out done assignments, courses whose term is gone, and meetings with no class left', () => {
    const gone: TimetableCourse = { ...fixture.courses[0]!, id: 'tc_GONEGONEGONEGONEGONEGO', termId: 'tt_MISSINGMISSINGMISSING' };
    const neverHeld: TimetableCourse = {
      ...fixture.courses[0]!,
      id: 'tc_NEVERNEVERNEVERNEVERNE',
      meetings: [{ ...fixture.courses[0]!.meetings[0]!, id: 'tm_NEVERNEVERNEVERNEVERNE', weekRule: 'list', weekList: [7] }],
    };
    const text = buildTimetableIcs({ ...fixture, courses: [gone, neverHeld] }, { nowMs: NOW, locale: 'zh' });
    expect(text).not.toContain('tc_GONE');
    // Week 7 is reading week, so the only listed week never has a class.
    // 第 7 周是阅读周，所以唯一列出的周从来没有课。
    expect(text).not.toContain('tm_NEVER');
    expect(text).not.toContain('Done thing');
    expect(text).toContain('UID:ta_AAAAAAAAAAAAAAAAAAAAA1@utmmsc.com');
  });

  it('writes a deadline in the repeated November hour in UTC', () => {
    // 2026-11-01 01:30 EST is the second 01:30 that night; Toronto wall time alone would mean the first one.
    // 2026-11-01 01:30 EST 是当晚第二个 01:30；只写多伦多时钟时间会被理解成第一个。
    const second: TimetableAssignment = { ...fixture.assignments[0]!, id: 'ta_DSTDSTDSTDSTDSTDSTDST', dueAt: '2026-11-01T06:30:00.000Z', remindOffsets: [] };
    const first: TimetableAssignment = { ...second, id: 'ta_EDTEDTEDTEDTEDTEDTEDT', dueAt: '2026-11-01T05:30:00.000Z' };
    const text = buildTimetableIcs({ ...fixture, courses: [], assignments: [second, first] }, { nowMs: NOW, locale: 'zh' });
    expect(text).toContain('DTSTART:20261101T063000Z');
    expect(text).toContain('DTSTART;TZID=America/Toronto:20261101T013000');
  });

  it('starts a term-less class this week and skips holidays from then on only', () => {
    const text = buildTimetableIcs({ ...fixture, skips: [{ onDate: '2026-10-16', meetingId: null, label: null }, ...fixture.skips] }, { nowMs: NOW, locale: 'zh' });
    expect(text).toContain('DTSTART;TZID=America/Toronto:20261023T190000');
    expect(text).not.toContain('20261016T190000');
  });

  it('names the file and type the share sheet uses', () => {
    expect(ICS_FILE_NAME).toBe('utmmsc-timetable.ics');
    expect(ICS_MIME_TYPE).toBe('text/calendar');
  });

  it('finds the first weekday on or after a date', () => {
    expect(firstWeekdayFrom(fall.startsOn, 4)).toBe('2026-09-03');
    expect(firstWeekdayFrom(fall.startsOn, 1)).toBe('2026-09-07');
    expect(firstWeekdayFrom(fall.startsOn, 3)).toBe('2026-09-09');
  });
});
