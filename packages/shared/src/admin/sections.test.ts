import { describe, expect, it } from 'vitest';
import { ROLES, type Role } from '../identity/roles';
import {
  ADMIN_COUNT_KEYS,
  ADMIN_SECTION_KEYS,
  ADMIN_SECTIONS,
  adminBadgeCount,
  adminCountsFor,
  adminPendingTotal,
  adminSectionsFor,
  canOpenAdmin,
  canReviewApplications,
  canReviewYearRequests,
  canUseAdminSection,
} from './sections';

const EXPECTED: Record<Role, string[]> = {
  student: [],
  alumni: [],
  honorary_alumni: [],
  honorary_external: [],
  head_technology: [],
  head_academic: [],
  head_publicity: [],
  head_sponsorship: [],
  head_events: ['events'],
  secretary_general: ['review', 'announcements'],
  vp_finance: [],
  vp_audit: [],
  president: ['review', 'members', 'channels', 'events', 'announcements', 'reports'],
  superadmin: ['review', 'members', 'advisors', 'channels', 'events', 'announcements', 'reports'],
};

describe('adminSectionsFor', () => {
  it('shows each role exactly its sections, in sidebar order', () => {
    for (const role of ROLES) expect(adminSectionsFor(role)).toEqual(EXPECTED[role]);
  });

  it('lists every section once in the sidebar table', () => {
    expect(ADMIN_SECTIONS.map((section) => section.key)).toEqual([...ADMIN_SECTION_KEYS]);
    for (const section of ADMIN_SECTIONS) expect(section.path).toBe(`/admin/${section.key}`);
  });

  it('gives a system admin testing another role exactly that role’s admin', () => {
    // MemberSelf.role is the test identity while one is active; realRole stays superadmin.
    const testing = { role: 'president' as Role, realRole: 'superadmin' as Role };
    expect(adminSectionsFor(testing.role)).toEqual(EXPECTED.president);
    expect(canReviewYearRequests(testing.role)).toBe(false);
    expect(canOpenAdmin({ role: 'student' })).toBe(false);
  });

  it('agrees with canUseAdminSection', () => {
    for (const role of ROLES) for (const key of ADMIN_SECTION_KEYS) expect(canUseAdminSection(role, key)).toBe(EXPECTED[role].includes(key));
  });
});

describe('canOpenAdmin', () => {
  it('opens admin for a role with at least one section', () => {
    expect(canOpenAdmin({ role: 'head_events' })).toBe(true);
    expect(canOpenAdmin({ role: 'secretary_general' })).toBe(true);
    expect(canOpenAdmin({ role: 'head_technology' })).toBe(false);
    expect(canOpenAdmin({ role: 'vp_finance' })).toBe(false);
    expect(canOpenAdmin(null)).toBe(false);
    expect(canOpenAdmin(undefined)).toBe(false);
  });
});

describe('review permissions', () => {
  it('lets approvers review applications and only the system admin review years', () => {
    expect(canReviewApplications('secretary_general')).toBe(true);
    expect(canReviewApplications('president')).toBe(true);
    expect(canReviewApplications('head_events')).toBe(false);
    expect(ROLES.filter(canReviewYearRequests)).toEqual(['superadmin']);
  });
});

describe('adminCountsFor', () => {
  it('gives the secretary no member counts and the head of events only events', () => {
    expect(adminCountsFor('secretary_general')).toEqual(['pendingApplications', 'announcementRecipients']);
    expect(adminCountsFor('head_events')).toEqual(['upcomingEvents']);
    expect(adminCountsFor('student')).toEqual([]);
  });

  it('gives the president everything but year requests and invitations, and the system admin everything', () => {
    expect(adminCountsFor('president')).toEqual(['pendingApplications', 'openReports', 'activeMembers', 'disabledMembers', 'channels', 'upcomingEvents', 'announcementRecipients']);
    expect(adminCountsFor('superadmin')).toEqual([...ADMIN_COUNT_KEYS]);
  });
});

describe('badges', () => {
  it('adds up waiting work per section and in total, ignoring missing and informational counts', () => {
    const counts = { pendingApplications: 3, pendingYearRequests: 1, openReports: 2, activeMembers: 128, channels: 9 };
    expect(adminBadgeCount('review', counts)).toBe(4);
    expect(adminBadgeCount('reports', counts)).toBe(2);
    expect(adminBadgeCount('members', counts)).toBe(0);
    expect(adminPendingTotal(counts)).toBe(6);
    expect(adminPendingTotal({})).toBe(0);
    expect(adminBadgeCount('review', { pendingApplications: 2 })).toBe(2);
  });
});
