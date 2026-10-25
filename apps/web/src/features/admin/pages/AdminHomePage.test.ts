import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminCounts, MemberSelf, Role } from '@utmmsc/shared';
import { AdminSidebar } from '../layout/AdminSidebar';
import type { AdminSummaryStatus } from '../state/summaryStore';
import { AdminHomePage } from './AdminHomePage';

/**
 * A server render reads every zustand store at its initial state, so the session and the summary are replaced by
 * plain holders the test fills in.
 * 服务端渲染读取的是每个 zustand store 的初始状态，因此把会话和摘要换成由测试填写的普通容器。
 */
const held = vi.hoisted(() => ({
  session: { token: null as string | null, member: null as unknown, mediaToken: null as string | null },
  counts: null as Record<string, number> | null,
  status: 'idle' as string,
}));

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

vi.mock('../state/summaryStore', () => {
  const state = () => ({ counts: held.counts ?? {}, status: held.status, loading: false, refresh: async () => undefined });
  return {
    useAdminCounts: () => (held.status === 'ready' ? held.counts : null),
    useAdminSummary: Object.assign((selector: (value: ReturnType<typeof state>) => unknown) => selector(state()), { getState: state }),
    refreshAdminSummary: () => undefined,
  };
});

function member(role: Role, extra: Partial<MemberSelf> = {}): MemberSelf {
  return {
    id: 'mem_a',
    displayName: 'A',
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
    email: 'a@mail.utoronto.ca',
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    realRole: role,
    actingRole: null,
    ...extra,
  };
}

function signIn(self: MemberSelf, counts: AdminCounts | null, status: AdminSummaryStatus = counts ? 'ready' : 'idle') {
  held.session = { token: 'tok', member: self, mediaToken: null };
  held.counts = counts as Record<string, number> | null;
  held.status = status;
}

function signOut() {
  held.session = { token: null, member: null, mediaToken: null };
  held.counts = null;
  held.status = 'idle';
}

function render(element: Parameters<typeof createElement>[0], path = '/admin'): string {
  return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [path] }, createElement(element)));
}

/** The visible text, without tags, so the checks read like the screen. */
/** 去掉标签后的可见文字，检查读起来就像屏幕上的内容。 */
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('admin overview', () => {
  // Layout effects warn on every server render; the markup is what is checked.
  // layout effect 在每次服务端渲染时都会警告；这里检查的是标记。
  beforeEach(() => {
    const error = console.error;
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      if (String(args[0]).includes('useLayoutEffect does nothing on the server')) return;
      error(...args);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    signOut();
  });

  it('puts the president’s waiting work first, then the actions and sections the role may use', () => {
    signIn(member('president'), { pendingApplications: 3, openReports: 2, activeMembers: 128, channels: 9, upcomingEvents: 2 });
    const page = text(render(AdminHomePage));
    expect(page.indexOf('待处理')).toBeLessThan(page.indexOf('快捷操作'));
    expect(page).toContain('3 个入会申请待审核');
    expect(page).toContain('2 条动态投诉待处理');
    expect(page).toContain('新建活动');
    expect(page).toContain('发布公告');
    expect(page).toContain('新建频道');
    expect(page).not.toContain('邀请荣誉顾问');
    expect(page).toContain('成员与身份');
    expect(page).toContain('128 人');
    expect(page).toContain('2 个即将开始');
    expect(page).not.toContain('荣誉顾问邀请');
    expect(page).toContain('当前身份：主席');
  });

  it('shows the secretary-general only review and announcements, and says when nothing waits', () => {
    signIn(member('secretary_general'), { pendingApplications: 0, announcementRecipients: 120 });
    const page = text(render(AdminHomePage));
    expect(page).toContain('暂时没有需要处理的事');
    expect(page).toContain('待审核');
    expect(page).toContain('公告');
    expect(page).not.toContain('成员与身份');
    expect(page).not.toContain('频道');
    expect(page).not.toContain('动态投诉');
  });

  it('hides the pending card when the server has no summary yet, instead of claiming nothing waits', () => {
    signIn(member('president'), {}, 'unavailable');
    const page = text(render(AdminHomePage));
    expect(page).not.toContain('待处理');
    expect(page).not.toContain('暂时没有需要处理的事');
    expect(page).toContain('成员与身份');
  });

  it('follows the test identity of a system admin, and offers the way back', () => {
    signIn(member('head_events', { realRole: 'superadmin', actingRole: 'head_events' }), { upcomingEvents: 1 });
    const page = text(render(AdminHomePage));
    expect(page).toContain('正在以活动部部长测试');
    expect(page).toContain('回到系统管理员');
    expect(page).toContain('新建活动');
    expect(page).not.toContain('待处理');
    expect(page).not.toContain('入学年份');
  });
});

describe('admin sidebar', () => {
  beforeEach(() => {
    const error = console.error;
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      if (String(args[0]).includes('useLayoutEffect does nothing on the server')) return;
      error(...args);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    signOut();
  });

  it('groups the sections, marks the current one and shows the waiting counts', () => {
    signIn(member('superadmin'), { pendingApplications: 2, pendingYearRequests: 1, openReports: 4 });
    const html = render(AdminSidebar, '/admin/members/mem_1');
    const page = text(html);
    for (const label of ['管理首页', '待审核', '成员与身份', '荣誉顾问邀请', '频道', '活动', '公告', '动态投诉']) expect(page).toContain(label);
    expect(page).toContain('成员');
    expect(page).toContain('内容');
    expect(page).toContain('安全');
    expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*href="\/admin\/members"/);
    expect(page).toContain('3 项待处理');
    expect(page).toContain('4 项待处理');
  });

  it('shows a one-section role only its section, with no overview to bounce off', () => {
    signIn(member('head_events'), { upcomingEvents: 1 });
    const page = text(render(AdminSidebar, '/admin/events'));
    expect(page).toContain('活动');
    expect(page).not.toContain('管理首页');
    expect(page).not.toContain('待审核');
    expect(page).not.toContain('频道');
  });
});
