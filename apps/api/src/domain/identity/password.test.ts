import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password';

describe('password hashing', () => {
  it('verifies the original password and rejects others', async () => {
    const stored = await hashPassword('correct horse battery');
    expect(stored.startsWith('pbkdf2-sha256$')).toBe(true);
    expect(await verifyPassword('correct horse battery', stored)).toBe(true);
    expect(await verifyPassword('correct horse batterx', stored)).toBe(false);
  });

  it('produces different hashes for the same password because of random salts', async () => {
    const a = await hashPassword('same');
    const b = await hashPassword('same');
    expect(a).not.toBe(b);
  });

  it('rejects malformed stored values without throwing', async () => {
    expect(await verifyPassword('x', 'garbage')).toBe(false);
    expect(await verifyPassword('x', 'pbkdf2-sha256$abc$salt$hash')).toBe(false);
  });
});
