import { describe, expect, it } from 'vitest';
import { emailDomainOf, isUniversityEmail, normalizeEmail } from './email-domains';

describe('isUniversityEmail', () => {
  it('accepts the three university domains', () => {
    expect(isUniversityEmail('sam.wu@mail.utoronto.ca')).toBe(true);
    expect(isUniversityEmail('staff@utoronto.ca')).toBe(true);
    expect(isUniversityEmail('grad@alumni.utoronto.ca')).toBe(true);
  });

  it('accepts departmental sub-domains', () => {
    expect(isUniversityEmail('x@cs.utoronto.ca')).toBe(true);
  });

  it('is case-insensitive and ignores surrounding whitespace', () => {
    expect(isUniversityEmail('  Sam@MAIL.UTORONTO.CA ')).toBe(true);
  });

  it('rejects look-alike and unrelated domains', () => {
    expect(isUniversityEmail('a@utoronto.ca.evil.com')).toBe(false);
    expect(isUniversityEmail('a@notutoronto.ca')).toBe(false);
    expect(isUniversityEmail('a@gmail.com')).toBe(false);
  });

  it('rejects malformed addresses', () => {
    expect(isUniversityEmail('utoronto.ca')).toBe(false);
    expect(isUniversityEmail('a@@mail.utoronto.ca')).toBe(false);
    expect(isUniversityEmail('')).toBe(false);
  });
});

describe('normalizeEmail / emailDomainOf', () => {
  it('normalizes and extracts the domain', () => {
    expect(normalizeEmail(' A@B.CA ')).toBe('a@b.ca');
    expect(emailDomainOf('A@Mail.UToronto.ca')).toBe('mail.utoronto.ca');
    expect(emailDomainOf('no-at-sign')).toBeNull();
  });
});
