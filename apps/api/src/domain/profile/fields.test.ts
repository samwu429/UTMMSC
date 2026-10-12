import { describe, expect, it } from 'vitest';
import { FieldError, experienceFromInput, openToFromInput, skillsFromInput } from './fields';

const NOW = new Date('2026-10-10T00:00:00Z');

describe('profile fields', () => {
  it('trims skills and drops duplicates and blanks', () => {
    expect(skillsFromInput([' Python ', 'Python', '', '咨询'])).toEqual(['Python', '咨询']);
  });

  it('rejects a skill list that is not a list or is too long', () => {
    expect(() => skillsFromInput('Python')).toThrow(FieldError);
    expect(() => skillsFromInput(Array.from({ length: 13 }, (_, i) => `技能${i}`))).toThrow(/12/);
    expect(() => skillsFromInput(['a'.repeat(21)])).toThrow(FieldError);
  });

  it('keeps known open-to choices once each', () => {
    expect(openToFromInput(['internship', 'internship', 'study'])).toEqual(['internship', 'study']);
    expect(() => openToFromInput(['job'])).toThrow(FieldError);
  });

  it('stores an ongoing experience without an end year', () => {
    const experience = experienceFromInput(
      { title: ' 研究助理 ', organization: 'UTM', startYear: 2025, endYear: 2026, current: true, description: '  ' },
      NOW,
    );
    expect(experience).toMatchObject({ title: '研究助理', organization: 'UTM', startYear: 2025, endYear: null, current: true, description: null });
  });

  it('requires the end year to follow the start year', () => {
    expect(() =>
      experienceFromInput({ title: '助教', organization: 'UTM', startYear: 2024, endYear: 2023, current: false }, NOW),
    ).toThrow(/结束年份/);
    expect(() => experienceFromInput({ title: '助教', organization: 'UTM', startYear: 1959, current: true }, NOW)).toThrow(/开始年份/);
  });
});
