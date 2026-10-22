import { describe, expect, it } from 'vitest';
import { enrollmentCalendarYear, enrollmentYearMax, enrollmentYearMin, isValidEnrollmentYear, shouldGraduate } from './member';

describe('enrollment year', () => {
  const now = new Date('2026-10-12T00:00:00Z');

  it('accepts only five years either side of the current year', () => {
    expect(enrollmentYearMin(now)).toBe(2021);
    expect(enrollmentYearMax(now)).toBe(2031);
    expect(isValidEnrollmentYear(2021, now)).toBe(true);
    expect(isValidEnrollmentYear(2031, now)).toBe(true);
    expect(isValidEnrollmentYear(2020, now)).toBe(false);
    expect(isValidEnrollmentYear(2032, now)).toBe(false);
  });

  it('turns a student into an alumnus after five years, and not before', () => {
    expect(shouldGraduate(2021, 'student', now)).toBe(true);
    expect(shouldGraduate(2022, 'student', now)).toBe(false);
    expect(shouldGraduate(2021, 'alumni', now)).toBe(false);
  });
});

describe('enrollmentCalendarYear', () => {
  // Migration 0014 computes the Toronto year in SQL as the UTC year five hours earlier. New Year in Toronto
  // always falls in standard time, so the two agree at every instant, including around daylight saving.
  // 迁移 0014 在 SQL 中把多伦多年份算作五小时之前的 UTC 年份。多伦多的新年总在标准时间内，所以二者在任何时刻都一致，夏令时前后也一样。
  const torontoYearInSql = (at: Date) => new Date(at.getTime() - 5 * 60 * 60 * 1000).getUTCFullYear();

  it('matches the SQL expression around New Year', () => {
    for (const iso of ['2026-01-01T04:59:59.999Z', '2026-01-01T05:00:00.000Z', '2025-12-31T23:59:59.999Z', '2027-01-01T04:00:00.000Z']) {
      const at = new Date(iso);
      expect(torontoYearInSql(at)).toBe(enrollmentCalendarYear(at));
    }
    expect(enrollmentCalendarYear(new Date('2026-01-01T04:59:59.999Z'))).toBe(2025);
    expect(enrollmentCalendarYear(new Date('2026-01-01T05:00:00.000Z'))).toBe(2026);
  });

  it('matches the SQL expression every few hours across two years', () => {
    const start = Date.parse('2025-01-01T00:00:00.000Z');
    const end = Date.parse('2027-01-02T00:00:00.000Z');
    for (let t = start; t < end; t += 7 * 60 * 60 * 1000) {
      expect(torontoYearInSql(new Date(t))).toBe(enrollmentCalendarYear(new Date(t)));
    }
  });
});
