import { describe, expect, it } from 'vitest';
import { enrollmentYearMax, enrollmentYearMin, isValidEnrollmentYear, shouldGraduate } from './member';

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
