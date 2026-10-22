import { describe, expect, it } from 'vitest';
import { CHANNEL_AUDIENCES, ENROLLMENT_STATUSES, ROLES, hasPermission, type EnrollmentStatus, type Role } from '@utmmsc/shared';
import { audienceRoleFilter, canPostInChannel, canReadChannel, type AudienceRoleFilter } from './channel-access';

const student = { role: 'student' as const, enrollmentStatus: 'student' as const };
const alumni = { role: 'alumni' as const, enrollmentStatus: 'alumni' as const };
const honorary = { role: 'honorary_alumni' as const, enrollmentStatus: 'alumni' as const };
const lead = { role: 'head_technology' as const, enrollmentStatus: 'student' as const };
const executive = { role: 'president' as const, enrollmentStatus: 'alumni' as const };
const finance = { role: 'vp_finance' as const, enrollmentStatus: 'student' as const };

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

  it('opens honorary, heads, officers, and staff to the matching office group', () => {
    const advisors = { audience: 'honorary' as const, postPolicy: 'members' as const, isMember: false };
    expect(canReadChannel(advisors, honorary)).toBe(true);
    expect(canReadChannel(advisors, student)).toBe(false);

    const heads = { audience: 'heads' as const, postPolicy: 'members' as const, isMember: false };
    expect(canReadChannel(heads, lead)).toBe(true);
    expect(canReadChannel(heads, finance)).toBe(false);

    const officers = { audience: 'officers' as const, postPolicy: 'members' as const, isMember: false };
    expect(canReadChannel(officers, finance)).toBe(true);
    expect(canReadChannel(officers, lead)).toBe(false);

    const staff = { audience: 'staff' as const, postPolicy: 'members' as const, isMember: false };
    expect(canReadChannel(staff, lead)).toBe(true);
    expect(canReadChannel(staff, finance)).toBe(true);
    expect(canReadChannel(staff, student)).toBe(false);
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

describe('audienceRoleFilter', () => {
  function matches(filter: AudienceRoleFilter, actor: { role: Role; enrollmentStatus: EnrollmentStatus }, isMember: boolean): boolean {
    switch (filter.kind) {
      case 'all':
        return true;
      case 'enrollment':
        return actor.enrollmentStatus === filter.status;
      case 'roles':
        return filter.roles.includes(actor.role);
      case 'custom':
        return isMember;
    }
  }

  it('agrees with canReadChannel for every role, enrollment and audience', () => {
    let checked = 0;
    for (const role of ROLES) {
      if (hasPermission(role, 'channels.manage')) continue;
      for (const enrollmentStatus of ENROLLMENT_STATUSES) {
        for (const audience of CHANNEL_AUDIENCES) {
          for (const isMember of [false, true]) {
            const actor = { role, enrollmentStatus };
            const expected = canReadChannel({ audience, postPolicy: 'members', isMember }, actor);
            expect(matches(audienceRoleFilter(audience), actor, isMember), `${role}/${enrollmentStatus}/${audience}/${String(isMember)}`).toBe(expected);
            checked += 1;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('derives role lists instead of hard-coding them', () => {
    const heads = audienceRoleFilter('heads');
    expect(heads.kind === 'roles' && heads.roles.every((role) => role.startsWith('head_'))).toBe(true);
    const staff = audienceRoleFilter('staff');
    expect(staff.kind === 'roles' && staff.roles.includes('superadmin')).toBe(true);
  });
});
