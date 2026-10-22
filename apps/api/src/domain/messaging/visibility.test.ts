import { describe, expect, it } from 'vitest';
import type { ChannelAudience, EnrollmentStatus, Role } from '@utmmsc/shared';
import {
  OPEN_ACCESS,
  audienceReaderChanges,
  carriedReaderJoins,
  coerceRoomAccess,
  implicitJoinTime,
  listActivityAt,
  roomAccess,
  type AudienceReader,
  type RoomAccessInput,
} from './visibility';

const FLOOR_SINCE = '2026-10-01T00:00:00.000Z';
const BEFORE = '2026-09-15T00:00:00.000Z';
const AFTER = '2026-10-10T08:30:00.000Z';

const custom: RoomAccessInput = {
  kind: 'channel',
  audience: 'custom',
  historyVisibility: 'since_join',
  floorSince: FLOOR_SINCE,
  channelCreatedAt: '2026-01-01T00:00:00.000Z',
  membershipJoinedAt: AFTER,
  memberCreatedAt: '2025-01-01T00:00:00.000Z',
  canManage: false,
};

const implicit: RoomAccessInput = {
  kind: 'channel',
  audience: 'student',
  historyVisibility: 'since_join',
  floorSince: FLOOR_SINCE,
  channelCreatedAt: '2026-01-01T00:00:00.000Z',
  memberCreatedAt: AFTER,
  canManage: false,
};

describe('roomAccess', () => {
  it('never floors a direct conversation', () => {
    expect(roomAccess({ kind: 'direct', historyVisibility: 'since_join', membershipJoinedAt: AFTER, canManage: false })).toEqual(OPEN_ACCESS);
  });

  it('fails open when the migration has not run', () => {
    expect(roomAccess({ ...custom, historyVisibility: undefined, floorSince: undefined })).toEqual(OPEN_ACCESS);
    expect(roomAccess({ ...implicit, historyVisibility: undefined })).toEqual(OPEN_ACCESS);
  });

  it('fails open when the join time is missing or unreadable', () => {
    expect(roomAccess({ ...custom, membershipJoinedAt: null })).toEqual(OPEN_ACCESS);
    expect(roomAccess({ ...custom, membershipJoinedAt: 'yesterday' })).toEqual(OPEN_ACCESS);
    expect(roomAccess({ ...implicit, memberCreatedAt: undefined })).toEqual(OPEN_ACCESS);
  });

  it('uses the membership row for custom channels', () => {
    expect(roomAccess(custom)).toEqual({ joinedAt: AFTER, floorApplies: true });
    expect(roomAccess({ ...custom, implicitJoinedAt: BEFORE })).toEqual({ joinedAt: AFTER, floorApplies: true });
  });

  it('uses the later of account and channel creation for implicit audiences', () => {
    expect(roomAccess(implicit)).toEqual({ joinedAt: AFTER, floorApplies: true });
    const newChannel = { ...implicit, memberCreatedAt: BEFORE, channelCreatedAt: AFTER, floorSince: AFTER };
    expect(roomAccess(newChannel)).toEqual({ joinedAt: AFTER, floorApplies: true });
  });

  it('prefers a recorded eligibility change over the creation fallback', () => {
    const later = '2026-10-20T12:00:00.000Z';
    expect(roomAccess({ ...implicit, memberCreatedAt: BEFORE, implicitJoinedAt: later })).toEqual({ joinedAt: later, floorApplies: true });
  });

  it('grandfathers members who joined before the policy instant', () => {
    expect(roomAccess({ ...custom, membershipJoinedAt: BEFORE })).toEqual(OPEN_ACCESS);
    expect(roomAccess({ ...implicit, memberCreatedAt: BEFORE })).toEqual(OPEN_ACCESS);
  });

  it('floors a member who joined exactly at the policy instant', () => {
    expect(roomAccess({ ...custom, membershipJoinedAt: FLOOR_SINCE })).toEqual({ joinedAt: FLOOR_SINCE, floorApplies: true });
  });

  it('falls back to channel creation when no policy instant is stored', () => {
    expect(roomAccess({ ...custom, floorSince: null, channelCreatedAt: FLOOR_SINCE })).toEqual({ joinedAt: AFTER, floorApplies: true });
  });

  it('keeps the join time but lifts the floor when new members may see all history', () => {
    expect(roomAccess({ ...custom, historyVisibility: 'all' })).toEqual({ joinedAt: AFTER, floorApplies: false });
  });

  it('exempts channel managers', () => {
    expect(roomAccess({ ...custom, canManage: true })).toEqual({ joinedAt: AFTER, floorApplies: false });
  });

  it('normalizes the join time to ISO', () => {
    expect(roomAccess({ ...custom, membershipJoinedAt: '2026-10-10T08:30:00Z' }).joinedAt).toBe(AFTER);
  });
});

describe('coerceRoomAccess', () => {
  it('keeps a well-formed value', () => {
    expect(coerceRoomAccess({ joinedAt: AFTER, floorApplies: true })).toEqual({ joinedAt: AFTER, floorApplies: true });
  });

  it('treats anything malformed as no floor', () => {
    expect(coerceRoomAccess(undefined)).toEqual(OPEN_ACCESS);
    expect(coerceRoomAccess('x')).toEqual(OPEN_ACCESS);
    expect(coerceRoomAccess({ joinedAt: 'nope', floorApplies: true })).toEqual(OPEN_ACCESS);
    expect(coerceRoomAccess({ joinedAt: null, floorApplies: true })).toEqual(OPEN_ACCESS);
    expect(coerceRoomAccess({ joinedAt: AFTER, floorApplies: 'yes' })).toEqual({ joinedAt: AFTER, floorApplies: false });
  });
});

describe('implicitJoinTime', () => {
  it('prefers a recorded eligibility change, else the later creation time', () => {
    expect(implicitJoinTime({ implicitJoinedAt: AFTER, memberCreatedAt: BEFORE, channelCreatedAt: BEFORE })).toBe(AFTER);
    expect(implicitJoinTime({ memberCreatedAt: BEFORE, channelCreatedAt: AFTER })).toBe(AFTER);
    expect(implicitJoinTime({ memberCreatedAt: AFTER, channelCreatedAt: BEFORE })).toBe(AFTER);
    expect(implicitJoinTime({ memberCreatedAt: null, channelCreatedAt: BEFORE })).toBeNull();
  });
});

describe('carriedReaderJoins', () => {
  const base = { postPolicy: 'members' as const, channelCreatedAt: '2026-01-01T00:00:00.000Z', implicitJoins: new Map<string, string>() };
  const student = { id: 's', role: 'student' as const, enrollmentStatus: 'student' as const, createdAt: BEFORE };
  const alumnus = { id: 'a', role: 'alumni' as const, enrollmentStatus: 'alumni' as const, createdAt: BEFORE };

  it('keeps the earlier join of members who could already read the channel', () => {
    const carried = carriedReaderJoins({ ...base, previousAudience: 'student', candidates: [student, alumnus] });
    expect([...carried]).toEqual([['s', BEFORE]]);
  });

  it('uses a recorded eligibility change as the earlier join', () => {
    const carried = carriedReaderJoins({ ...base, previousAudience: 'student', candidates: [student], implicitJoins: new Map([['s', AFTER]]) });
    expect(carried.get('s')).toBe(AFTER);
  });

  it('carries everyone over from an all-members channel', () => {
    expect(carriedReaderJoins({ ...base, previousAudience: 'all', candidates: [student, alumnus] }).size).toBe(2);
  });

  it('carries nobody when the channel already had a member list', () => {
    expect(carriedReaderJoins({ ...base, previousAudience: 'custom', candidates: [student] }).size).toBe(0);
  });
});

describe('audienceReaderChanges', () => {
  const reader = (id: string, role: Role, enrollmentStatus: EnrollmentStatus = 'student', membership: { wasMember?: boolean; isMember?: boolean } = {}): AudienceReader => ({
    id,
    role,
    enrollmentStatus,
    wasMember: membership.wasMember ?? false,
    isMember: membership.isMember ?? false,
  });
  const student = reader('s', 'student');
  const alumnus = reader('a', 'alumni', 'alumni');
  const head = reader('h', 'head_events');
  const officer = reader('o', 'secretary_general');
  const president = reader('p', 'president');
  const superadmin = reader('x', 'superadmin');
  const changes = (previousAudience: ChannelAudience, nextAudience: ChannelAudience, candidates: AudienceReader[]) =>
    audienceReaderChanges({ previousAudience, nextAudience, postPolicy: 'members', candidates });

  it('lets in members who could not read before and leaves existing readers alone', () => {
    expect(changes('student', 'all', [student, alumnus, head])).toEqual({ joined: ['a'], left: [] });
  });

  it('shuts out members who lose access', () => {
    expect(changes('all', 'heads', [student, alumnus, head, officer])).toEqual({ joined: [], left: ['s', 'a', 'o'] });
    expect(changes('heads', 'officers', [student, head, officer])).toEqual({ joined: ['o'], left: ['h'] });
  });

  it('never touches channel managers, who read every channel', () => {
    expect(changes('student', 'alumni', [president, superadmin])).toEqual({ joined: [], left: [] });
    expect(changes('custom', 'heads', [president, superadmin])).toEqual({ joined: [], left: [] });
  });

  it('decides by the viewed role, so a system admin acting as a student is treated as one', () => {
    const acting = reader('x', 'student');
    expect(changes('alumni', 'student', [acting])).toEqual({ joined: ['x'], left: [] });
  });

  it('lets in only non-members when a member list becomes an implicit audience', () => {
    const listedStudent = reader('m', 'student', 'student', { wasMember: true });
    const listedAlumnus = reader('n', 'alumni', 'alumni', { wasMember: true });
    expect(changes('custom', 'student', [student, alumnus, listedStudent, listedAlumnus])).toEqual({ joined: ['s'], left: ['n'] });
  });

  it('records no joins for a custom target, whose membership rows hold the join times, but still drops readers left out', () => {
    const listedAlumnus = reader('n', 'alumni', 'alumni', { isMember: true });
    const listedStudent = reader('m', 'student', 'student', { isMember: true });
    expect(changes('student', 'custom', [student, alumnus, listedAlumnus, listedStudent])).toEqual({ joined: [], left: ['s'] });
  });

  it('changes nothing when the audience stays the same', () => {
    expect(changes('student', 'student', [student, alumnus])).toEqual({ joined: [], left: [] });
  });
});

describe('listActivityAt', () => {
  const floored = { joinedAt: AFTER, floorApplies: true };

  it('shows the channel activity time when no floor applies', () => {
    expect(listActivityAt(OPEN_ACCESS, BEFORE, null)).toBe(BEFORE);
    expect(listActivityAt({ joinedAt: AFTER, floorApplies: false }, BEFORE, null)).toBe(BEFORE);
  });

  it('never shows a floored member activity from before their join', () => {
    expect(listActivityAt(floored, BEFORE, null)).toBe(AFTER);
    const later = '2026-10-20T12:00:00.000Z';
    expect(listActivityAt(floored, later, later)).toBe(later);
  });
});
