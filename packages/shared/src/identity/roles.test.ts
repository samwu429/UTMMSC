import { describe, expect, it } from 'vitest';
import { canAssignRole, hasPermission, isOfficeRole, isStaffRole, ROLES } from './roles';

describe('role permissions', () => {
  it('gives every role the base member permissions', () => {
    for (const role of ROLES) {
      expect(hasPermission(role, 'chat.send')).toBe(true);
      expect(hasPermission(role, 'directory.view')).toBe(true);
    }
  });

  it('follows the constitution instead of one shared executive bucket', () => {
    expect(hasPermission('head_events', 'events.manage')).toBe(true);
    expect(hasPermission('head_technology', 'events.manage')).toBe(false);
    expect(hasPermission('head_technology', 'files.upload')).toBe(true);
    expect(hasPermission('secretary_general', 'members.approve')).toBe(true);
    expect(hasPermission('secretary_general', 'members.assign_role')).toBe(false);
    expect(hasPermission('vp_finance', 'files.upload')).toBe(true);
    expect(hasPermission('vp_finance', 'announcements.send')).toBe(false);
    expect(hasPermission('vp_audit', 'files.upload')).toBe(false);
    expect(hasPermission('president', 'members.assign_role')).toBe(true);
    expect(hasPermission('president', 'channels.manage')).toBe(true);
    expect(hasPermission('student', 'members.approve')).toBe(false);
  });
});

describe('canAssignRole', () => {
  it('lets the president appoint members and department heads only', () => {
    expect(canAssignRole('president', 'head_technology')).toBe(true);
    expect(canAssignRole('president', 'student')).toBe(true);
    expect(canAssignRole('president', 'secretary_general')).toBe(false);
    expect(canAssignRole('president', 'president')).toBe(false);
    expect(canAssignRole('president', 'superadmin')).toBe(false);
    expect(canAssignRole('president', 'honorary_alumni')).toBe(false);
    expect(canAssignRole('president', 'honorary_external')).toBe(false);
  });

  it('lets only the system admin appoint honorary advisors', () => {
    expect(canAssignRole('superadmin', 'honorary_alumni')).toBe(true);
    expect(canAssignRole('superadmin', 'honorary_external')).toBe(true);
    expect(isOfficeRole('honorary_alumni')).toBe(false);
    expect(isOfficeRole('honorary_external')).toBe(false);
  });

  it('allows the system admin to assign any role', () => {
    expect(canAssignRole('superadmin', 'president')).toBe(true);
    expect(canAssignRole('superadmin', 'superadmin')).toBe(true);
  });

  it('denies department heads and other presidium officers', () => {
    expect(canAssignRole('head_events', 'student')).toBe(false);
    expect(canAssignRole('secretary_general', 'student')).toBe(false);
    expect(canAssignRole('vp_audit', 'student')).toBe(false);
  });
});

describe('offices', () => {
  it('treats constitution offices as unique and staff', () => {
    expect(isOfficeRole('president')).toBe(true);
    expect(isOfficeRole('head_academic')).toBe(true);
    expect(isOfficeRole('student')).toBe(false);
    expect(isOfficeRole('superadmin')).toBe(false);
    expect(isStaffRole('head_publicity')).toBe(true);
    expect(isStaffRole('alumni')).toBe(false);
  });
});
