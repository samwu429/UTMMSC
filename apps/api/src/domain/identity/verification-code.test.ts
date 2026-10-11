import { describe, expect, it } from 'vitest';
import { CODE_MAX_ATTEMPTS, evaluateVerification, generateCode, hashCode, isCodeShape } from './verification-code';

describe('verification codes', () => {
  it('generates six digits, preserving leading zeros', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateCode();
      expect(code).toMatch(/^\d{6}$/);
    }
  });

  it('validates shape strictly', () => {
    expect(isCodeShape('012345')).toBe(true);
    expect(isCodeShape('12345')).toBe(false);
    expect(isCodeShape('1234567')).toBe(false);
    expect(isCodeShape('12a456')).toBe(false);
  });

  it('binds the hash to the email address', async () => {
    const a = await hashCode('a@mail.utoronto.ca', '123456');
    const b = await hashCode('b@mail.utoronto.ca', '123456');
    expect(a).not.toBe(b);
    expect(a).toBe(await hashCode('a@mail.utoronto.ca', '123456'));
  });

  it('evaluates expiry, consumption and attempt limits', () => {
    const now = new Date('2026-10-10T00:00:00Z');
    const future = new Date(now.getTime() + 60_000).toISOString();
    const past = new Date(now.getTime() - 1).toISOString();
    expect(evaluateVerification({ expiresAt: future, attempts: 0, consumedAt: null }, now)).toBe('ok');
    expect(evaluateVerification({ expiresAt: past, attempts: 0, consumedAt: null }, now)).toBe('expired');
    expect(evaluateVerification({ expiresAt: future, attempts: CODE_MAX_ATTEMPTS, consumedAt: null }, now)).toBe('too_many_attempts');
    expect(evaluateVerification({ expiresAt: future, attempts: 0, consumedAt: past }, now)).toBe('consumed');
  });
});
