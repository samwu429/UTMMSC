import { describe, expect, it } from 'vitest';
import { canPostInChannel, canReadChannel } from './channel-access';

const student = { role: 'student' as const, enrollmentStatus: 'student' as const };
const alumni = { role: 'alumni' as const, enrollmentStatus: 'alumni' as const };
const lead = { role: 'head_technology' as const, enrollmentStatus: 'student' as const };
const executive = { role: 'president' as const, enrollmentStatus: 'alumni' as const };

describe('canReadChannel', () => {
  it('opens all-audience channels to everyone', () => {
    const ch = { audience: 'all' as const, postPolicy: 'members' as const, isMember: false };
    expect(canReadChannel(ch, student)).toBe(true);
    expect(canReadChannel(ch, alumni)).toBe(true);
  });

  it('matches student and alumni channels on enrollment status', () => {
    const students = { audience: 'student' as const, postPolicy: 'members' as const, isMember: false };
    expect(canReadChannel(students, student)).toBe(true);
    expect(canReadChannel(students, alumni)).toBe(false);
    expect(canReadChannel(students, executive)).toBe(true);
  });

  it('requires membership for custom channels unless the actor manages channels', () => {
    const custom = { audience: 'custom' as const, postPolicy: 'members' as const, isMember: false };
    expect(canReadChannel(custom, student)).toBe(false);
    expect(canReadChannel({ ...custom, isMember: true }, student)).toBe(true);
    expect(canReadChannel(custom, executive)).toBe(true);
  });
});

describe('canPostInChannel', () => {
  it('restricts staff-only channels to department heads and presidium', () => {
    const notices = { audience: 'all' as const, postPolicy: 'staff' as const, isMember: false };
    expect(canPostInChannel(notices, student)).toBe(false);
    expect(canPostInChannel(notices, lead)).toBe(true);
    expect(canPostInChannel(notices, executive)).toBe(true);
  });

  it('never allows posting where reading is denied', () => {
    const alumniOnly = { audience: 'alumni' as const, postPolicy: 'members' as const, isMember: false };
    expect(canPostInChannel(alumniOnly, student)).toBe(false);
    expect(canPostInChannel(alumniOnly, alumni)).toBe(true);
  });
});
