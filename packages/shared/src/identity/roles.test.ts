import { describe, expect, it } from 'vitest';
import { canAssignRole, hasPermission, isStaffRole, ROLES } from './roles';

describe('role permissions', () => {
  it('gives every role the base member permissions', () => {
    for (const role of ROLES) {
      expect(hasPermission(role, 'chat.send')).toBe(true);
      expect(hasPermission(role, 'directory.view')).toBe(true);
    }
  });

  it('reserves moderation and approvals for executives and above', () => {
    expect(hasPermission('department_lead', 'chat.moderate')).toBe(false);
    expect(hasPermission('executive', 'chat.moderate')).toBe(true);
    expect(hasPermission('executive', 'members.approve')).toBe(true);
    expect(hasPermission('student', 'members.approve')).toBe(false);
  });

  it('lets department leads upload files and manage events', () => {
    expect(hasPermission('department_lead', 'files.upload')).toBe(true);
    expect(hasPermission('department_lead', 'events.manage')).toBe(true);
    expect(hasPermission('alumni', 'files.upload')).toBe(false);
  });
});

describe('canAssignRole', () => {
  it('allows executives to assign roles strictly below themselves', () => {
    expect(canAssignRole('executive', 'department_lead')).toBe(true);
    expect(canAssignRole('executive', 'student')).toBe(true);
    expect(canAssignRole('executive', 'executive')).toBe(false);
    expect(canAssignRole('executive', 'superadmin')).toBe(false);
  });

  it('allows superadmin to assign any role', () => {
    expect(canAssignRole('superadmin', 'executive')).toBe(true);
    expect(canAssignRole('superadmin', 'superadmin')).toBe(true);
  });

  it('denies roles without the permission', () => {
    expect(canAssignRole('department_lead', 'student')).toBe(false);
    expect(canAssignRole('student', 'student')).toBe(false);
  });
});

describe('isStaffRole', () => {
  it('treats department leads and above as staff', () => {
    expect(isStaffRole('student')).toBe(false);
    expect(isStaffRole('alumni')).toBe(false);
    expect(isStaffRole('department_lead')).toBe(true);
    expect(isStaffRole('superadmin')).toBe(true);
  });
});
