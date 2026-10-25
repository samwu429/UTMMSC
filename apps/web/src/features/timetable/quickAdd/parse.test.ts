import { describe, expect, it } from 'vitest';
import { readAssignment, type TimetableCourse, type TimetableTerm } from '@utmmsc/shared';
import { parseQuickAdd, type QuickAddContext } from './parse';
import { quickAddBody, quickAddChips, remindText } from './preview';

/** Saturday 2026-10-24, 12:00 in Toronto (EDT). */
/** 多伦多时间 2026-10-24 周六 12:00（夏令时）。 */
const NOW = Date.UTC(2026, 9, 24, 16, 0);

const fall: Pick<TimetableTerm, 'id' | 'startsOn' | 'endsOn'> = { id: 'tt_FALLFALLFALLFALLFALLFA', startsOn: '2026-09-03', endsOn: '2026-12-03' };
const winter: Pick<TimetableTerm, 'id' | 'startsOn' | 'endsOn'> = { id: 'tt_WINTERWINTERWINTERWINx', startsOn: '2027-01-05', endsOn: '2027-04-05' };

const courses: Pick<TimetableCourse, 'id' | 'code' | 'termId'>[] = [
  { id: 'tc_MATFALLMATFALLMATFALLx', code: 'MAT102H5F', termId: fall.id },
  { id: 'tc_MATWINTERMATWINTERMATx', code: 'MAT102H5S', termId: winter.id },
  { id: 'tc_CSCCSCCSCCSCCSCCSCCSCx', code: 'CSC108H5', termId: fall.id },
  { id: 'tc_CHOIRCHOIRCHOIRCHOIRCx', code: '合唱团', termId: null },
];

const context: QuickAddContext = { courses, terms: [fall, winter], nowMs: NOW };

function parse(text: string, ctx: QuickAddContext = context) {
  return parseQuickAdd(text, ctx);
}

function due(text: string): [string, string] {
  const result = parse(text);
  return [result.title, result.dueAt];
}

describe('parseQuickAdd', () => {
  it('reads the placeholder example', () => {
    expect(parse('PS3 MAT102 周五 23:59')).toEqual({
      title: 'PS3',
      courseId: 'tc_MATFALLMATFALLMATFALLx',
      courseCode: 'MAT102',
      hasDate: true,
      hasTime: true,
      dueDate: '2026-10-30',
      dueMinute: 1439,
      dueAt: '2026-10-31T03:59:00.000Z',
    });
  });

  it('matches a known course in any case and with or without weight and session', () => {
    for (const text of ['ps3 mat102 fri 11:59pm', 'PS3 MAT102H5 friday 11:59 PM', 'PS3 mat102h5f Fri. 11:59 p.m.']) {
      expect(parse(text)).toMatchObject({ title: text.slice(0, 3), courseCode: 'MAT102', dueAt: '2026-10-31T03:59:00.000Z' });
    }
    expect(parse('合唱团 报名 周三')).toMatchObject({ title: '报名', courseId: 'tc_CHOIRCHOIRCHOIRCHOIRCx', courseCode: '合唱团' });
    expect(parse('csc108 A1')).toMatchObject({ title: 'A1', courseId: 'tc_CSCCSCCSCCSCCSCCSCCSCx' });
  });

  it('leaves an unknown code in the title', () => {
    expect(parse('Essay CSC999 tomorrow')).toMatchObject({ title: 'Essay CSC999', courseId: null, courseCode: null, dueDate: '2026-10-25' });
  });

  it('picks the course whose term holds the deadline when two share a code', () => {
    expect(parse('PS1 MAT102 1/20').courseId).toBe('tc_MATWINTERMATWINTERMATx');
    expect(parse('PS4 MAT102 11/20').courseId).toBe('tc_MATFALLMATFALLMATFALLx');
  });

  it('reads relative day words in both languages', () => {
    expect(due('Lab 4 明天 17:00')).toEqual(['Lab 4', '2026-10-25T21:00:00.000Z']);
    expect(due('essay 后天')).toEqual(['essay', '2026-10-27T03:59:00.000Z']);
    expect(due('essay 大后天')).toEqual(['essay', '2026-10-28T03:59:00.000Z']);
    expect(due('reading tmr 9am')).toEqual(['reading', '2026-10-25T13:00:00.000Z']);
    expect(due('reading tomorrow noon')).toEqual(['reading', '2026-10-25T16:00:00.000Z']);
    expect(due('reflection today')).toEqual(['reflection', '2026-10-25T03:59:00.000Z']);
    expect(due('essay 今晚')).toEqual(['essay', '2026-10-25T03:59:00.000Z']);
  });

  it('reads weekdays: the next one still ahead, or next week with 下周 / next', () => {
    expect(parse('PS 周一').dueDate).toBe('2026-10-26');
    expect(parse('PS 下周一 下午2点半')).toMatchObject({ dueDate: '2026-10-26', dueMinute: 870 });
    expect(parse('PS 下周六').dueDate).toBe('2026-10-31');
    expect(parse('PS 下下周三').dueDate).toBe('2026-11-04');
    expect(parse('PS next wed').dueDate).toBe('2026-10-28');
    expect(parse('PS this sun').dueDate).toBe('2026-10-25');
    expect(parse('PS 本周日').dueDate).toBe('2026-10-25');
    // Today is Saturday: 23:59 is still ahead, 09:00 is not.
    // 今天是周六：23:59 还没到，09:00 已经过了。
    expect(parse('PS 周六').dueDate).toBe('2026-10-24');
    expect(parse('PS 星期六 9:00').dueDate).toBe('2026-10-31');
  });

  it('reads M/D, M月D日 and month names, rolling past dates into next year', () => {
    expect(due('quiz 10/31 9am')).toEqual(['quiz', '2026-10-31T13:00:00.000Z']);
    expect(due('读书报告 11月3日 晚上11点')).toEqual(['读书报告', '2026-11-04T04:00:00.000Z']);
    expect(parse('读书报告 11月3号').dueDate).toBe('2026-11-03');
    expect(parse('essay Oct 31').dueDate).toBe('2026-10-31');
    expect(parse('essay October 31st 5pm')).toMatchObject({ dueDate: '2026-10-31', dueMinute: 1020 });
    expect(parse('final 1/15').dueDate).toBe('2027-01-15');
    // Three weeks ago is kept, so an overdue item can be logged.
    // 三周前的日期保持不变，以便记下已逾期的作业。
    expect(parse('PS1 10/1').dueDate).toBe('2026-10-01');
    expect(parse('PS 2/30').title).toBe('PS 2/30');
  });

  it('reads times in both languages', () => {
    const minute = (text: string) => parse(`PS 明天 ${text}`).dueMinute;
    expect(minute('23:59')).toBe(1439);
    expect(minute('23：59')).toBe(1439);
    expect(minute('11:59pm')).toBe(1439);
    expect(minute('11pm')).toBe(1380);
    expect(minute('12pm')).toBe(720);
    expect(minute('12am')).toBe(0);
    expect(minute('midnight')).toBe(1439);
    expect(minute('晚上11点')).toBe(1380);
    expect(minute('晚上十一点')).toBe(1380);
    expect(minute('晚上12点')).toBe(1439);
    expect(minute('下午5点半')).toBe(1050);
    expect(minute('11点59分')).toBe(719);
    expect(minute('上午9点一刻')).toBe(555);
    expect(minute('中午12点')).toBe(720);
    expect(minute('中午1点')).toBe(780);
    expect(minute('午夜')).toBe(1439);
  });

  it('does not mistake words for times', () => {
    expect(parse('快一点交 PS3').hasTime).toBe(false);
    expect(parse('快一点交 PS3').title).toBe('快一点交 PS3');
    expect(parse('PS3pm draft').hasTime).toBe(false);
    expect(parse('Ch 25:61 notes').title).toBe('Ch 25:61 notes');
  });

  it('defaults to today 23:59, or tomorrow when a time alone has passed', () => {
    expect(parse('PS')).toMatchObject({ hasDate: false, hasTime: false, dueDate: '2026-10-24', dueMinute: 1439 });
    expect(parse('PS 11:00')).toMatchObject({ hasDate: false, hasTime: true, dueDate: '2026-10-25', dueMinute: 660 });
    expect(parse('PS 18:00')).toMatchObject({ dueDate: '2026-10-24', dueMinute: 1080 });
  });

  it('keeps Toronto time on the far side of the November switch', () => {
    expect(parse('PS 11/2 9:00').dueAt).toBe('2026-11-02T14:00:00.000Z');
  });

  it('tidies the title: separators at the ends and empty brackets go', () => {
    expect(parse('  PS3, MAT102 - 周五 ').title).toBe('PS3');
    expect(parse('PS3 [MAT102]').title).toBe('PS3');
    expect(parse('明天 23:59').title).toBe('');
    expect(Array.from(parse('x'.repeat(300)).title)).toHaveLength(120);
  });

  it('gives a body the server accepts', () => {
    for (const text of ['PS3 MAT102 周五 23:59', 'PS1 10/1', 'final 1/15', '读书报告 11月3日 晚上11点', 'PS']) {
      const body = quickAddBody(parse(text), ['1d', '1h'], 'ta_QUICKQUICKQUICKQUICKQU');
      expect(body).not.toBeNull();
      expect(readAssignment(body, NOW).ok).toBe(true);
    }
  });
});

describe('quick add preview', () => {
  it('shows title, course, deadline and reminders, marking an assumed deadline', () => {
    expect(quickAddChips(parse('PS3 MAT102 周五 23:59'), ['1d', '1h'], NOW, 'zh')).toEqual([
      { kind: 'title', text: 'PS3', missing: false },
      { kind: 'course', text: 'MAT102' },
      { kind: 'due', text: '周五 23:59', assumed: false },
      { kind: 'remind', text: '提醒 1天 · 1小时' },
    ]);
    expect(quickAddChips(parse('PS'), [], NOW, 'en')).toEqual([
      { kind: 'title', text: 'PS', missing: false },
      { kind: 'due', text: 'Today 11:59 PM', assumed: true },
      { kind: 'remind', text: 'No reminders' },
    ]);
    expect(quickAddChips(parse('明天'), ['morning'], NOW, 'zh')[0]).toEqual({ kind: 'title', text: '写上作业名称', missing: true });
  });

  it('builds nothing without a title', () => {
    expect(quickAddBody(parse('明天 17:00'), ['1d'], 'ta_QUICKQUICKQUICKQUICKQU')).toBeNull();
    expect(quickAddBody(parse('Lab MAT102 明天'), ['1d'], 'ta_QUICKQUICKQUICKQUICKQU')).toEqual({
      id: 'ta_QUICKQUICKQUICKQUICKQU',
      courseId: 'tc_MATFALLMATFALLMATFALLx',
      title: 'Lab',
      notes: null,
      dueAt: '2026-10-26T03:59:00.000Z',
      remindOffsets: ['1d'],
    });
  });

  it('names reminders in both languages', () => {
    expect(remindText(['1w', 'morning', '30m'], 'zh')).toBe('提醒 1周 · 当天早上 · 30分钟');
    expect(remindText(['2d', '3h'], 'en')).toBe('Remind 2 days · 3 h');
  });
});
