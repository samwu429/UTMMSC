import { describe, expect, it } from 'vitest';
import { ROLE_LABELS, type AdminMemberRow, type Role } from '@utmmsc/shared';
import {
  correctedStatus,
  editBlock,
  enrollmentLocked,
  filterCounts,
  groupMembers,
  limitGroups,
  matchesFilter,
  matchesQuery,
  membersPath,
  officeHolders,
  readMemberFilter,
  replaceMember,
  roleChoices,
  searchText,
  withEnrollment,
  withRole,
} from './memberRules';

const NOW = new Date('2026-10-24T12:00:00.000Z');

function person(id: string, role: Role, extra: Partial<AdminMemberRow> = {}): AdminMemberRow {
  return {
    id,
    displayName: id,
    role,
    enrollmentStatus: role === 'alumni' || role.startsWith('honorary') ? 'alumni' : 'student',
    graduationYear: 2024,
    major: null,
    headline: null,
    about: null,
    location: null,
    skills: [],
    openTo: [],
    avatarKey: null,
    coverKey: null,
    email: `${id}@mail.utoronto.ca`,
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...extra,
  };
}

const club = [
  person('zoe', 'student'),
  person('amy', 'student'),
  person('pres', 'president'),
  person('sec', 'secretary_general'),
  person('tech', 'head_technology'),
  person('old_tech', 'head_technology', { status: 'disabled' }),
  person('adv', 'honorary_external'),
  person('grad', 'alumni', { graduationYear: 2018 }),
  person('root', 'superadmin'),
];

describe('filters', () => {
  it('reads ?f= and falls back to all', () => {
    expect(readMemberFilter('heads')).toBe('heads');
    expect(readMemberFilter('disabled')).toBe('disabled');
    expect(readMemberFilter('nope')).toBe('all');
    expect(readMemberFilter(null)).toBe('all');
  });

  it('puts disabled members under 已停用 only, and counts every chip', () => {
    const old = club.find((member) => member.id === 'old_tech')!;
    expect(matchesFilter(old, 'heads')).toBe(false);
    expect(matchesFilter(old, 'disabled')).toBe(true);
    expect(matchesFilter(old, 'all')).toBe(true);
    expect(filterCounts(club)).toEqual({ all: 9, presidium: 2, heads: 1, members: 3, honorary: 1, disabled: 1 });
  });
});

describe('search', () => {
  const names = (role: Role) => [ROLE_LABELS[role], role === 'head_technology' ? 'Head of Technology' : ''];

  it('matches name, email and either name of the role, ignoring case', () => {
    const tech = searchText(club.find((member) => member.id === 'tech')!, names);
    expect(matchesQuery(tech, '科技部')).toBe(true);
    expect(matchesQuery(tech, 'head of TECH')).toBe(true);
    expect(matchesQuery(tech, 'TECH@mail')).toBe(true);
    expect(matchesQuery(tech, '主席')).toBe(false);
  });

  it('needs every word, and an empty query matches everyone', () => {
    const text = searchText(person('zhang san', 'student'), names);
    expect(matchesQuery(text, 'zhang 在校生')).toBe(true);
    expect(matchesQuery(text, 'zhang 主席')).toBe(false);
    expect(matchesQuery(text, '   ')).toBe(true);
  });
});

describe('grouping', () => {
  it('lists the highest tier first and orders roles inside a group', () => {
    const groups = groupMembers(club);
    expect(groups.map((group) => group.label)).toEqual(['系统', '主席团', '部门', '荣誉顾问', '成员']);
    expect(groups[1]!.members.map((member) => member.id)).toEqual(['pres', 'sec']);
    // Active before disabled for the same role.
    // 同一身份中在用的排在已停用的之前。
    expect(groups[2]!.members.map((member) => member.id)).toEqual(['tech', 'old_tech']);
    // 在校生 before 毕业生, then by name.
    // 在校生在毕业生之前，然后按姓名排列。
    expect(groups[4]!.members.map((member) => member.id)).toEqual(['amy', 'zoe', 'grad']);
  });

  it('shows a page of rows across groups and counts the rest', () => {
    const groups = groupMembers(club);
    const page = limitGroups(groups, 4);
    expect(page.groups.map((group) => [group.label, group.members.length])).toEqual([
      ['系统', 1],
      ['主席团', 2],
      ['部门', 1],
    ]);
    expect(page.hidden).toBe(5);
    expect(limitGroups(groups, 100).hidden).toBe(0);
    expect(limitGroups(groups, 0)).toEqual({ groups: [], hidden: 9 });
  });
});

describe('offices and rights', () => {
  it('finds the active holder of each office', () => {
    const holders = officeHolders(club);
    expect(holders.get('head_technology')?.id).toBe('tech');
    expect(holders.get('president')?.id).toBe('pres');
    expect(holders.has('student')).toBe(false);
    expect(holders.has('honorary_external')).toBe(false);
  });

  it('says why the viewer cannot change a member', () => {
    const president = { id: 'pres', role: 'president' as Role };
    expect(editBlock(president, club[0]!)).toBeNull();
    expect(editBlock(president, { id: 'pres', role: 'president' })).toBe('self');
    expect(editBlock(president, { id: 'sec', role: 'secretary_general' })).toBe('rank');
    expect(editBlock(president, { id: 'adv', role: 'honorary_external' })).toBe('honorary');
    expect(editBlock({ id: 'root', role: 'superadmin' }, { id: 'sec', role: 'secretary_general' })).toBeNull();
    expect(editBlock({ id: 'root', role: 'superadmin' }, { id: 'root', role: 'superadmin' })).toBe('self');
  });

  it('offers a president department heads and members, and explains the rest', () => {
    const holders = officeHolders(club);
    const target = club.find((member) => member.id === 'amy')!;
    const groups = roleChoices('president', target, holders, NOW);
    expect(groups.map((group) => group.label)).toEqual(['成员', '荣誉顾问', '部门', '主席团']);
    const all = groups.flatMap((group) => group.choices);
    const of = (role: Role) => all.find((choice) => choice.role === role)!;
    expect(of('student').block).toBeNull();
    expect(of('alumni').block).toBeNull();
    expect(of('head_events').block).toBeNull();
    expect(of('head_technology')).toMatchObject({ block: 'held', holder: { id: 'tech' } });
    expect(of('honorary_alumni').block).toBe('superadmin_only');
    expect(of('secretary_general').block).toBe('superadmin_only');
  });

  it('keeps the current role open, blocks 在校生 five years on, and shows 系统 to the system admin only', () => {
    const holders = officeHolders(club);
    const tech = club.find((member) => member.id === 'tech')!;
    expect(roleChoices('superadmin', tech, holders, NOW).flatMap((group) => group.choices).find((choice) => choice.role === 'head_technology')?.block).toBeNull();
    const grad = club.find((member) => member.id === 'grad')!;
    const choices = roleChoices('superadmin', grad, holders, NOW);
    expect(choices.map((group) => group.label)).toContain('系统');
    expect(choices.flatMap((group) => group.choices).find((choice) => choice.role === 'student')?.block).toBe('graduated');
  });
});

describe('enrollment corrections', () => {
  it('locks the status five years on and for honorary advisors', () => {
    expect(enrollmentLocked({ role: 'student', graduationYear: 2024 }, NOW)).toBe(false);
    expect(enrollmentLocked({ role: 'student', graduationYear: 2021 }, NOW)).toBe(true);
    expect(enrollmentLocked({ role: 'honorary_alumni', graduationYear: 2024 }, NOW)).toBe(true);
  });

  it('stores 毕业生 when the year is five or more years back or the role cannot be a student', () => {
    expect(correctedStatus({ role: 'student' }, 2024, 'student', NOW)).toBe('student');
    expect(correctedStatus({ role: 'student' }, 2020, 'student', NOW)).toBe('alumni');
    expect(correctedStatus({ role: 'honorary_alumni' }, 2024, 'student', NOW)).toBe('alumni');
    expect(correctedStatus({ role: 'head_events' }, 2024, 'alumni', NOW)).toBe('alumni');
  });

  it('moves 在校生 and 毕业生 with the status, as the server does', () => {
    expect(withEnrollment(person('a', 'student'), 2019, 'alumni')).toMatchObject({ role: 'alumni', graduationYear: 2019, enrollmentStatus: 'alumni' });
    expect(withEnrollment(person('b', 'alumni'), 2025, 'student')).toMatchObject({ role: 'student', enrollmentStatus: 'student' });
    expect(withEnrollment(person('c', 'head_events'), 2019, 'alumni').role).toBe('head_events');
  });

  it('applies a role change with the status the server returned', () => {
    expect(withRole(person('a', 'student'), 'alumni', 'alumni')).toMatchObject({ role: 'alumni', enrollmentStatus: 'alumni' });
    expect(withRole(person('a', 'student'), 'head_events')).toMatchObject({ role: 'head_events', enrollmentStatus: 'student' });
    const list = [person('a', 'student'), person('b', 'student')];
    expect(replaceMember(list, withRole(list[1]!, 'head_events'))?.map((member) => member.role)).toEqual(['student', 'head_events']);
    expect(replaceMember(undefined, list[0]!)).toBeUndefined();
  });
});

describe('addresses', () => {
  it('keeps the list query on a member address', () => {
    expect(membersPath()).toBe('/admin/members');
    expect(membersPath('mem_1', '?q=zh&f=heads')).toBe('/admin/members/mem_1?q=zh&f=heads');
    expect(membersPath('a/b')).toBe('/admin/members/a%2Fb');
  });
});
