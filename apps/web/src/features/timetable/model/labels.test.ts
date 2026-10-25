import { describe, expect, it } from 'vitest';
import { term, tid } from './fixtures.testdata';
import { dateRange, kindLabel, monthDay, termOfWeek, weekRuleText, weekTitle, weekdayChar, weekdayShort } from './labels';

const FALL = term();

describe('weekTitle', () => {
  it('numbers term weeks and names reading week', () => {
    expect(weekTitle([FALL], '2026-10-19', 'zh')).toMatchObject({ text: '第7周', week: 7, readingWeek: false });
    expect(weekTitle([FALL], '2026-10-19', 'en').text).toBe('Week 7');
    expect(weekTitle([FALL], '2026-10-26', 'zh')).toMatchObject({ text: '阅读周', week: 8, readingWeek: true });
    expect(weekTitle([FALL], '2026-10-26', 'en').text).toBe('Reading week');
  });

  it('counts the short first week of a term that starts mid-week', () => {
    expect(weekTitle([FALL], '2026-09-07', 'zh').text).toBe('第1周');
  });

  it('shows the dates outside a term', () => {
    expect(weekTitle([FALL], '2026-12-14', 'zh')).toMatchObject({ text: '12/14–12/20', term: null, week: null });
    expect(weekTitle([], '2026-10-26', 'en').text).toBe('Oct 26–Nov 1');
    expect(weekTitle([], '2026-10-26', 'zh').text).toBe('10/26–11/1');
  });

  it('finds the term of a week from any of its days', () => {
    const summer = term({ id: tid('tt', 'summer'), startsOn: '2027-05-06', endsOn: '2027-08-13', skipWeeks: [] });
    expect(termOfWeek([summer], '2027-05-03')?.id).toBe(summer.id);
    expect(termOfWeek([summer], '2027-04-26')).toBeNull();
  });
});

describe('labels', () => {
  it('writes weekdays, dates and ranges', () => {
    expect(weekdayChar(1, 'zh')).toBe('一');
    expect(weekdayChar(7, 'en')).toBe('Sun');
    expect(weekdayShort(3, 'zh')).toBe('周三');
    expect(monthDay('2026-11-03', 'zh')).toBe('11月3日');
    expect(monthDay('2026-11-03', 'en')).toBe('Nov 3');
    expect(dateRange('2026-10-05', '2026-10-11', 'en')).toBe('Oct 5–11');
  });

  it('names kinds and week rules', () => {
    expect(kindLabel('tut', 'zh')).toBe('辅导');
    expect(kindLabel('pra', 'en')).toBe('Practical');
    expect(weekRuleText({ weekRule: 'odd', weekList: null }, 'zh')).toBe('单周');
    expect(weekRuleText({ weekRule: 'list', weekList: [1, 3, 6] }, 'zh')).toBe('第 1、3、6 周');
    expect(weekRuleText({ weekRule: 'list', weekList: [2, 4] }, 'en')).toBe('Weeks 2, 4');
  });
});
