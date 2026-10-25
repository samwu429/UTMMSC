import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminAnnouncementRow, AdminEventRecord, EventNotificationRow, MemberSelf, Role } from '@utmmsc/shared';
import { AnnouncementsSection } from '../announcements/Section';
import { ANNOUNCEMENTS_KEY, type AnnouncementHistory } from '../announcements/announcementData';
import { adminCache } from '../state/adminCache';
import { EVENTS_KEY } from './eventData';
import { EventsSection } from './Section';

/**
 * The events and announcements screens rendered on the server with data already in the admin cache. The session is a
 * plain holder, because a server render reads zustand stores at their initial state.
 * 在服务端渲染活动和公告各界面，数据预先放在管理后台缓存中。会话换成普通容器，因为服务端渲染读取的是 zustand store 的初始状态。
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

function self(role: Role): MemberSelf {
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
  };
}

const DAY = 86_400_000;

function iso(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

function notice(id: string, status: EventNotificationRow['status'], recipientCount: number | null = null): EventNotificationRow {
  return { id, kind: 'custom', sendAt: iso(DAY), status, sentAt: status === 'sent' ? iso(-DAY) : null, recipientCount };
}

function event(id: string, title: string, startsAt: string, extra: Partial<AdminEventRecord> = {}): AdminEventRecord {
  return { id, title, startsAt, location: null, description: null, notifications: [], ...extra };
}

function announcement(id: string, title: string, extra: Partial<AdminAnnouncementRow> = {}): AdminAnnouncementRow {
  return { id, title, body: '第一行\n第二行', sentAt: iso(-3 * 3600_000), recipientCount: 120, emailed: true, sentBy: { id: 'me', displayName: '张三' }, ...extra };
}

function render(screen: ComponentType, path: string): string {
  return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [path] }, createElement(screen)));
}

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

const events = [
  event('soon', '读书会', iso(3 * DAY), { location: 'Bahen 1180', notifications: [notice('n1', 'pending'), notice('n2', 'pending')] }),
  event('later', '迎新', iso(10 * DAY), { notifications: [notice('n3', 'failed')] }),
  event('done', '期末聚餐', iso(-20 * DAY), { notifications: [notice('n4', 'sent', 52)] }),
];

describe('event screens', () => {
  beforeEach(() => {
    const error = console.error;
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      if (String(args[0]).includes('useLayoutEffect does nothing on the server')) return;
      error(...args);
    });
    held.session = { token: 'tok', member: self('head_events'), mediaToken: null };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    adminCache.clear();
    held.session = { token: null, member: null, mediaToken: null };
  });

  it('shows skeleton rows, never 没有活动, before the list arrives', () => {
    const page = render(EventsSection, '/admin/events');
    expect(page).toContain('role="status"');
    expect(text(page)).not.toContain('没有即将开始的活动');
  });

  it('lists upcoming events soonest first with their notice chips and count', () => {
    adminCache.mutate(EVENTS_KEY, () => events);
    const html = render(EventsSection, '/admin/events');
    const page = text(html);
    expect(page.indexOf('读书会')).toBeLessThan(page.indexOf('迎新'));
    expect(page).not.toContain('期末聚餐');
    expect(page).toContain('即将开始 （2）');
    expect(page).toContain('2 条通知待发送');
    expect(page).toContain('通知失败');
    expect(page).toContain('Bahen 1180');
    expect(html).toContain('href="/admin/events/new"');
  });

  it('shows past events under 已结束 with how many were notified', () => {
    adminCache.mutate(EVENTS_KEY, () => events);
    const page = text(render(EventsSection, '/admin/events?view=past'));
    expect(page).toContain('期末聚餐');
    expect(page).toContain('已通知 52 人');
    expect(page).not.toContain('读书会');
  });

  it('says there is nothing upcoming, with 新建活动', () => {
    adminCache.mutate(EVENTS_KEY, () => [events[2]!]);
    const page = text(render(EventsSection, '/admin/events'));
    expect(page).toContain('没有即将开始的活动');
    expect(page).toContain('新建活动');
  });

  it('opens an event with its notices, 复制为新活动 and 删除活动', () => {
    adminCache.mutate(EVENTS_KEY, () => events);
    const html = render(EventsSection, '/admin/events/soon');
    const page = text(html);
    expect(page).toContain('读书会');
    expect(page).toContain('多伦多时间');
    expect(page).toContain('待发送');
    expect(html).toContain('href="/admin/events/new?from=soon"');
    expect(page).toContain('删除活动');
  });

  it('fills the form from the event it copies', () => {
    adminCache.mutate(EVENTS_KEY, () => events);
    const html = render(EventsSection, '/admin/events/new?from=soon');
    expect(text(html)).toContain('复制为新活动');
    expect(html).toContain('value="读书会"');
    expect(html).toContain('value="Bahen 1180"');
    expect(text(html)).toContain('保存活动');
  });

  it('starts an empty form otherwise', () => {
    adminCache.mutate(EVENTS_KEY, () => events);
    const html = render(EventsSection, '/admin/events/new');
    expect(text(html)).toContain('新建活动');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>保存活动<\/button>/);
  });
});

describe('announcement screens', () => {
  beforeEach(() => {
    const error = console.error;
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      if (String(args[0]).includes('useLayoutEffect does nothing on the server')) return;
      error(...args);
    });
    held.session = { token: 'tok', member: self('secretary_general'), mediaToken: null };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    adminCache.clear();
    held.session = { token: null, member: null, mediaToken: null };
  });

  it('lists what was sent, saying when it was only saved', () => {
    const history: AnnouncementHistory = {
      announcements: [announcement('a1', '期中通知'), announcement('a2', '草稿', { emailed: false, sentBy: null })],
      nextCursor: 'c1',
      unavailable: false,
    };
    adminCache.mutate(ANNOUNCEMENTS_KEY, () => history);
    const html = render(AnnouncementsSection, '/admin/announcements');
    const page = text(html);
    expect(page).toContain('期中通知');
    expect(page).toContain('张三 · 邮件 120 人');
    expect(page).toContain('已删除的成员 · 仅保存');
    expect(page).toContain('加载更多');
    expect(html).toContain('href="/admin/announcements/new"');
  });

  it('says history is not available on a server without it, and still offers 发布公告', () => {
    adminCache.mutate<AnnouncementHistory>(ANNOUNCEMENTS_KEY, () => ({ announcements: [], nextCursor: null, unavailable: true }));
    const page = text(render(AnnouncementsSection, '/admin/announcements'));
    expect(page).toContain('历史记录暂不可用');
    expect(page).toContain('发布公告');
  });

  it('composes with email on by default and says what happens without it', () => {
    adminCache.mutate<AnnouncementHistory>(ANNOUNCEMENTS_KEY, () => ({ announcements: [], nextCursor: null, unavailable: false }));
    const html = render(AnnouncementsSection, '/admin/announcements/new');
    const page = text(html);
    expect(page).toContain('0/80');
    expect(page).toContain('0/5000');
    expect(page).toContain('发送邮件给全体在用成员');
    expect(html).toMatch(/role="switch" aria-checked="true"/);
    expect(page).toContain('不发邮件时，公告只保存在这里，成员看不到。');
    expect(page).toContain('预览并发送');
  });

  it('keeps the compose fields out of a form, so Enter in the title cannot save or send', () => {
    adminCache.mutate<AnnouncementHistory>(ANNOUNCEMENTS_KEY, () => ({ announcements: [], nextCursor: null, unavailable: false }));
    const html = render(AnnouncementsSection, '/admin/announcements/new');
    expect(html).not.toContain('<form');
    expect(html).toContain('enterKeyHint="next"');
  });

  it('opens a sent announcement read-only', () => {
    adminCache.mutate<AnnouncementHistory>(ANNOUNCEMENTS_KEY, () => ({ announcements: [announcement('a1', '期中通知')], nextCursor: null, unavailable: false }));
    const page = text(render(AnnouncementsSection, '/admin/announcements/a1'));
    expect(page).toContain('期中通知');
    expect(page).toContain('第一行');
    expect(page).toContain('发给 120 位成员，这里看不到是否送达');
  });
});
