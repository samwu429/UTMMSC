import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminMemberRow, ManualApplication, MemberSelf, Role } from '@utmmsc/shared';
import { MembersSection } from '../members/Section';
import { ReviewSection } from '../review/Section';
import { adminCache } from '../state/adminCache';

/**
 * The section screens rendered on the server with data already in the admin cache (a plain store, so the render
 * sees it), checking what each role is offered. The session is a plain holder, because a server render reads zustand
 * stores at their initial state.
 * 在服务端渲染各板块界面，数据预先放在管理后台缓存中（普通的存储，渲染能看到它），检查每种身份能看到什么。会话换成普通容器，因为服务端渲染
 * 读取的是 zustand store 的初始状态。
 */
const held = vi.hoisted(() => ({ session: { token: null as string | null, member: null as unknown, mediaToken: null as string | null } }));

vi.mock('../../../shared/session/store', () => {
  const hook = (selector: (state: typeof held.session) => unknown) => selector(held.session);
  return {
    useSessionStore: Object.assign(hook, {
      getState: () => held.session,
      setState: (patch: Partial<typeof held.session>) => Object.assign(held.session, patch),
      subscribe: () => () => undefined,
    }),
  };
});

function self(role: Role, extra: Partial<MemberSelf> = {}): MemberSelf {
  return {
    id: 'me',
    displayName: 'Me',
    role,
    enrollmentStatus: 'student',
    graduationYear: 2024,
    major: null,
    headline: null,
    about: null,
    location: null,
    skills: [],
    openTo: [],
    avatarKey: null,
    coverKey: null,
    email: 'me@mail.utoronto.ca',
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    realRole: role,
    actingRole: null,
    ...extra,
  };
}

function row(id: string, displayName: string, role: Role, extra: Partial<AdminMemberRow> = {}): AdminMemberRow {
  return { ...self(role), id, displayName, email: `${id}@mail.utoronto.ca`, status: 'active', ...extra } as AdminMemberRow;
}

function application(id: string, displayName: string, createdAt: string): ManualApplication {
  return { id, email: `${id}@gmail.com`, displayName, enrollmentStatus: 'student', graduationYear: 2025, major: null, note: '你好', status: 'pending', createdAt };
}

function render(screen: ComponentType, path: string): string {
  return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [path] }, createElement(screen)));
}

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

const club = [
  row('me', 'Me', 'president'),
  row('sec', '秘书', 'secretary_general'),
  row('tech', '科技', 'head_technology'),
  row('old', '旧部长', 'head_events', { status: 'disabled' }),
  row('stu', '学生', 'student'),
  row('adv', '顾问', 'honorary_external'),
];

describe('section screens', () => {
  beforeEach(() => {
    const error = console.error;
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      if (String(args[0]).includes('useLayoutEffect does nothing on the server')) return;
      error(...args);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    adminCache.clear();
    held.session = { token: null, member: null, mediaToken: null };
  });

  it('lists applications oldest first, with no year segment for a president', () => {
    held.session = { token: 'tok', member: self('president'), mediaToken: null };
    adminCache.mutate<ManualApplication[]>('applications', () => [application('a2', '后来的', '2026-10-02T00:00:00.000Z'), application('a1', '先来的', '2026-10-01T00:00:00.000Z')].sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
    const page = text(render(ReviewSection, '/admin/review'));
    expect(page.indexOf('先来的')).toBeLessThan(page.indexOf('后来的'));
    expect(page).not.toContain('入学年份 （');
    expect(page).toContain('选择');
  });

  it('gives the system admin both segments with their counts', () => {
    held.session = { token: 'tok', member: self('superadmin'), mediaToken: null };
    adminCache.mutate<ManualApplication[]>('applications', () => [application('a1', '先来的', '2026-10-01T00:00:00.000Z')]);
    adminCache.mutate('yearRequests', () => []);
    const html = render(ReviewSection, '/admin/review?type=years');
    expect(html).toMatch(/role="tab" aria-selected="true"[^>]*>入学年份/);
    expect(text(html)).toContain('入会申请 （1）');
    expect(text(html)).toContain('没有待审核的入学年份申请');
  });

  it('opens an application with decline and approve at the bottom', () => {
    held.session = { token: 'tok', member: self('president'), mediaToken: null };
    adminCache.mutate<ManualApplication[]>('applications', () => [application('a1', '先来的', '2026-10-01T00:00:00.000Z')]);
    const html = render(ReviewSection, '/admin/review/applications/a1?type=applications');
    const page = text(html);
    expect(page).toContain('a1@gmail.com');
    expect(page).toContain('申请说明 你好');
    const buttons = [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((match) => match[1]);
    expect(buttons.indexOf('拒绝')).toBeGreaterThan(-1);
    expect(buttons.indexOf('拒绝')).toBeLessThan(buttons.indexOf('通过'));
  });

  it('groups members from the presidium down, with chip counts and 已停用 apart', () => {
    held.session = { token: 'tok', member: self('president'), mediaToken: null };
    adminCache.mutate('members', () => club);
    const page = text(render(MembersSection, '/admin/members'));
    expect(page).toContain('全部 6');
    expect(page).toContain('部门部长 1');
    expect(page).toContain('已停用 1');
    const headers = [...render(MembersSection, '/admin/members').matchAll(/<h2[^>]*>([^<]*)<\/h2>/g)].map((match) => match[1]);
    expect(headers).toEqual(['主席团 2', '部门 2', '荣誉顾问 1', '成员 1']);
    expect(page).toContain('身份规则');
  });

  it('filters by chip from the address', () => {
    held.session = { token: 'tok', member: self('president'), mediaToken: null };
    adminCache.mutate('members', () => club);
    const page = text(render(MembersSection, '/admin/members?f=disabled'));
    expect(page).toContain('旧部长');
    expect(page).not.toContain('科技 ');
  });

  it('lets a president change a department head, but not a presidium member or himself', () => {
    held.session = { token: 'tok', member: self('president'), mediaToken: null };
    adminCache.mutate('members', () => club);
    const head = render(MembersSection, '/admin/members/tech');
    expect(head).toContain('href="/admin/members/tech/role"');
    expect(text(head)).toContain('停用账号');
    const peer = text(render(MembersSection, '/admin/members/sec'));
    expect(peer).toContain('你不能修改职位不低于你的成员。');
    expect(peer).not.toContain('停用账号');
    const own = text(render(MembersSection, '/admin/members/me'));
    expect(own).toContain('不能修改自己的身份和账号状态。');
  });

  it('explains in the role picker why a role cannot be given', () => {
    held.session = { token: 'tok', member: self('president'), mediaToken: null };
    adminCache.mutate('members', () => club);
    const page = text(render(MembersSection, '/admin/members/stu/role'));
    expect(page).toContain('已由科技担任');
    expect(page).toContain('只有系统管理员可以指定');
    expect(page).not.toContain('系统管理员 系统账号');
  });

  it('offers enrollment corrections to the system admin only, by the viewed role', () => {
    adminCache.mutate('members', () => club);
    held.session = { token: 'tok', member: self('superadmin'), mediaToken: null };
    expect(render(MembersSection, '/admin/members/stu')).toContain('href="/admin/members/stu/year"');
    held.session = { token: 'tok', member: self('president', { realRole: 'superadmin', actingRole: 'president' }), mediaToken: null };
    const testing = render(MembersSection, '/admin/members/stu');
    expect(testing).not.toContain('href="/admin/members/stu/year"');
    expect(text(testing)).toContain('入学年份只有系统管理员能改。');
  });
});
