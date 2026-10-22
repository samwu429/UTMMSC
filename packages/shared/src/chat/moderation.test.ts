import { describe, expect, it } from 'vitest';
import { ROLES, roleTier } from '../identity/roles';
import { canModerateRoom, decideModeration } from './moderation';

describe('canModerateRoom', () => {
  it('allows moderation only in channels and only with chat.moderate', () => {
    expect(canModerateRoom('channel', 'president')).toBe(true);
    expect(canModerateRoom('channel', 'superadmin')).toBe(true);
    expect(canModerateRoom('channel', 'secretary_general')).toBe(false);
    expect(canModerateRoom('channel', 'student')).toBe(false);
    expect(canModerateRoom('direct', 'president')).toBe(false);
    expect(canModerateRoom('direct', 'superadmin')).toBe(false);
  });
});

describe('decideModeration', () => {
  const channel = { roomKind: 'channel' as const };

  it('lets the president moderate members and department heads', () => {
    expect(decideModeration({ ...channel, actorRole: 'president', targetRole: 'student' })).toBe('ok');
    expect(decideModeration({ ...channel, actorRole: 'president', targetRole: 'honorary_alumni' })).toBe('ok');
    expect(decideModeration({ ...channel, actorRole: 'president', targetRole: 'head_events' })).toBe('ok');
  });

  it('stops the president at their own tier and at the system admin', () => {
    expect(decideModeration({ ...channel, actorRole: 'president', targetRole: 'secretary_general' })).toBe('outranked');
    expect(decideModeration({ ...channel, actorRole: 'president', targetRole: 'president' })).toBe('outranked');
    expect(decideModeration({ ...channel, actorRole: 'president', targetRole: 'superadmin' })).toBe('outranked');
  });

  it('lets the system admin moderate anyone, including another system admin', () => {
    for (const role of ROLES) {
      expect(decideModeration({ ...channel, actorRole: 'superadmin', targetRole: role })).toBe('ok');
    }
  });

  it('never lets anyone but the system admin moderate the system admin', () => {
    for (const role of ROLES.filter((r) => r !== 'superadmin')) {
      expect(decideModeration({ ...channel, actorRole: role, targetRole: 'superadmin' })).not.toBe('ok');
    }
  });

  it('allows a strictly lower tier and nothing else for every pair with chat.moderate', () => {
    for (const target of ROLES) {
      const expected = roleTier(target) < roleTier('president') ? 'ok' : 'outranked';
      expect(decideModeration({ ...channel, actorRole: 'president', targetRole: target })).toBe(expected);
    }
  });

  it('refuses members without chat.moderate whatever the target', () => {
    expect(decideModeration({ ...channel, actorRole: 'student', targetRole: 'student' })).toBe('no_permission');
    expect(decideModeration({ ...channel, actorRole: 'vp_audit', targetRole: 'student' })).toBe('no_permission');
  });

  it('refuses moderation of the other person in a direct conversation', () => {
    expect(decideModeration({ roomKind: 'direct', actorRole: 'president', targetRole: 'student' })).toBe('direct');
    expect(decideModeration({ roomKind: 'direct', actorRole: 'superadmin', targetRole: 'student' })).toBe('direct');
  });

  it('allows a target whose account is gone', () => {
    expect(decideModeration({ ...channel, actorRole: 'president', targetRole: null })).toBe('ok');
  });
});
