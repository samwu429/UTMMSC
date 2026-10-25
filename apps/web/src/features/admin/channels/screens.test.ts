import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminChannelRow, AdminMemberRow, MemberSelf, Role } from '@utmmsc/shared';
import { ChannelIconEditor } from '../../chat/info/ChannelIconEditor';
import { isAdminPath } from '../layout/AdminScreen';
import { AdminHistory } from '../layout/adminHistory';
import { adminCache } from '../state/adminCache';
import { CHANNELS_KEY } from './channelData';
import { settingsBackTarget } from './channelParts';
import { ChannelsSection } from './Section';

/**
 * The channel screens rendered on the server with data already in the admin cache, checking what each screen
 * offers. The session is a plain holder, because a server render reads zustand stores at their initial state.
 * 在服务端渲染频道各界面，数据预先放在管理后台缓存中，检查每个界面提供的内容。会话换成普通容器，因为服务端渲染读取的是 zustand store 的初始状态。
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

function member(id: string, displayName: string, role: Role, extra: Partial<AdminMemberRow> = {}): AdminMemberRow {
  return { ...self(role), id, displayName, email: `${id}@mail.utoronto.ca`, status: 'active', ...extra } as AdminMemberRow;
}

function channel(id: string, name: string, extra: Partial<AdminChannelRow> = {}): AdminChannelRow {
  return {
    id,
    slug: id,
    name,
    description: null,
    audience: 'all',
    postPolicy: 'members',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastMessageAt: null,
    memberIds: [],
    historyVisibility: 'since_join',
    iconKey: null,
    iconUpdatedAt: null,
    ...extra,
  };
}

function render(screen: ComponentType, path: string): string {
  return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [path] }, createElement(screen)));
}

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

const channels = [
  channel('ch_a', '学术交流', { audience: 'student', description: '论文与课程', lastMessageAt: '2026-10-20T00:00:00.000Z' }),
  channel('ch_b', '部长群', { audience: 'custom', memberIds: ['tech', 'me'], postPolicy: 'staff', historyVisibility: 'all', lastMessageAt: '2026-10-23T00:00:00.000Z' }),
  channel('ch_c', '公告', { iconKey: 'preset:announce' }),
];

const club = [member('me', 'Me', 'president'), member('tech', '科技', 'head_technology'), member('stu', '学生', 'student'), member('old', '旧人', 'student', { status: 'disabled' })];

describe('channel screens', () => {
  beforeEach(() => {
    const error = console.error;
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      if (String(args[0]).includes('useLayoutEffect does nothing on the server')) return;
      error(...args);
    });
    held.session = { token: 'tok', member: self('president'), mediaToken: 'mt' };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    adminCache.clear();
    held.session = { token: null, member: null, mediaToken: null };
  });

  it('shows skeleton rows, not an empty state, before the list arrives', () => {
    const page = render(ChannelsSection, '/admin/channels');
    expect(page).toContain('role="status"');
    expect(text(page)).not.toContain('还没有频道');
  });

  it('lists channels by recent activity with chips, badges and 新建', () => {
    adminCache.mutate(CHANNELS_KEY, () => channels);
    const html = render(ChannelsSection, '/admin/channels');
    const page = text(html);
    expect(page.indexOf('部长群')).toBeLessThan(page.indexOf('学术交流'));
    expect(page).toContain('全部 3');
    expect(page).toContain('按身份开放 2');
    expect(page).toContain('指定成员 1');
    expect(page).toContain('新成员可看历史');
    expect(page).toContain('仅负责人发言');
    expect(page).toContain('指定成员 · 2 人');
    expect(page).toContain('在校生 · 所有人可发言');
    expect(page).toContain('无消息');
    expect(html).toContain('href="/admin/channels/new"');
    expect(html).toContain('href="/admin/channels/ch_a"');
    expect(html).toContain('channel-icons/announce.svg');
  });

  it('filters and searches from the address', () => {
    adminCache.mutate(CHANNELS_KEY, () => channels);
    const custom = text(render(ChannelsSection, '/admin/channels?f=custom'));
    expect(custom).toContain('部长群');
    expect(custom).not.toContain('学术交流');
    const found = text(render(ChannelsSection, '/admin/channels?q=%E8%AE%BA%E6%96%87'));
    expect(found).toContain('学术交流');
    expect(found).not.toContain('部长群');
    expect(text(render(ChannelsSection, '/admin/channels?q=zzz'))).toContain('没有找到「zzz」');
  });

  it('offers 新建频道 when there are no channels at all', () => {
    adminCache.mutate(CHANNELS_KEY, () => []);
    const page = text(render(ChannelsSection, '/admin/channels'));
    expect(page).toContain('还没有频道');
    expect(page).toContain('新建频道');
  });

  it('lays the settings out like 群管理, with the icon row, members for custom and delete at the end', () => {
    adminCache.mutate(CHANNELS_KEY, () => channels);
    const html = render(ChannelsSection, '/admin/channels/ch_b?f=custom');
    const page = text(html);
    expect(page).toContain('频道设置');
    expect(page).toContain('2 位成员');
    expect(page).toContain('频道图标');
    expect(html).toContain('href="/admin/channels/ch_b/name?f=custom"');
    expect(html).toContain('href="/admin/channels/ch_b/members?f=custom"');
    expect(html).toContain('href="/admin/channels/ch_b/post?f=custom"');
    expect(html).toContain('href="/chat/room/channel%3Ach_b"');
    expect(html).toMatch(/role="switch" aria-checked="true"/);
    expect(page.indexOf('打开频道')).toBeLessThan(page.indexOf('删除频道'));
  });

  it('leaves the icon row out for a server before channel icons, and the members row for an open channel', () => {
    adminCache.mutate(CHANNELS_KEY, () => [channel('ch_x', '旧服务器', { iconKey: undefined, iconUpdatedAt: undefined })]);
    const html = render(ChannelsSection, '/admin/channels/ch_x');
    const page = text(html);
    expect(page).not.toContain('频道图标');
    expect(html).not.toContain('/admin/channels/ch_x/members');
    expect(page).toContain('全体成员可见');
  });

  it('asks for the list again before saying a channel is gone', () => {
    adminCache.mutate(CHANNELS_KEY, () => channels);
    const html = render(ChannelsSection, '/admin/channels/ch_gone');
    expect(text(html)).not.toContain('找不到这个频道');
    expect(text(html)).not.toContain('删除频道');
    expect(html).toContain('role="status"');
  });

  it('opens a deep link from its own entry before the list arrives', () => {
    adminCache.mutate('channel:ch_b', () => channels[1]);
    expect(text(render(ChannelsSection, '/admin/channels/ch_b'))).toContain('部长群');
  });

  it('edits the name in one field with 保存 and a counter', () => {
    adminCache.mutate(CHANNELS_KEY, () => channels);
    const html = render(ChannelsSection, '/admin/channels/ch_a/name');
    expect(html).toContain('value="学术交流"');
    expect(text(html)).toContain('4/40');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>保存<\/button>/);
  });

  it('focuses the field itself, since AdminScreen moves focus to the heading after an autoFocus applies', () => {
    adminCache.mutate(CHANNELS_KEY, () => channels);
    expect(render(ChannelsSection, '/admin/channels/ch_a/name')).not.toMatch(/autofocus/i);
    expect(render(ChannelsSection, '/admin/channels/ch_a/description')).not.toMatch(/autofocus/i);
  });

  it('lets the badges wrap under the audience instead of squeezing it', () => {
    adminCache.mutate(CHANNELS_KEY, () => channels);
    const html = render(ChannelsSection, '/admin/channels');
    const line = html.match(/<span class="([^"]*)"><span class="([^"]*)">指定成员 · 2 人<\/span>/);
    expect(line).not.toBeNull();
    expect(line?.[1]).toContain('flex-wrap');
    expect(line?.[2]).toContain('truncate');
    expect(line?.[2]).not.toContain('flex-1');
  });

  it('explains every audience and that managers always see the channel', () => {
    adminCache.mutate(CHANNELS_KEY, () => channels);
    const page = text(render(ChannelsSection, '/admin/channels/ch_a/audience'));
    expect(page).toContain('所有在用成员');
    expect(page).toContain('部长和主席团');
    expect(page).toContain('只有你选的人');
    expect(page).toContain('能管理频道的人始终看得到全部频道。');
  });

  it('starts the picker empty for a channel that is not custom yet, so 完成 needs a pick', () => {
    adminCache.mutate(CHANNELS_KEY, () => channels);
    adminCache.mutate('members', () => club);
    const html = render(ChannelsSection, '/admin/channels/ch_a/members');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>完成（0）<\/button>/);
    expect(html).not.toMatch(/role="checkbox" aria-checked="true"/);
  });

  it('picks members grouped by role with 全选 and 完成 (n), listing active members only', () => {
    adminCache.mutate(CHANNELS_KEY, () => channels);
    adminCache.mutate('members', () => club);
    const html = render(ChannelsSection, '/admin/channels/ch_b/members');
    const page = text(html);
    expect(page).toContain('完成（2）');
    expect(page).toContain('全选');
    expect(page).toContain('取消全选');
    expect(page).not.toContain('旧人');
    expect(html).toMatch(/role="checkbox" aria-checked="true"[^>]*data-admin-row="tech"/);
    expect(html).toMatch(/role="checkbox" aria-checked="false"[^>]*data-admin-row="stu"/);
    expect(html).toContain('aria-label="移出科技"');
  });

  it('builds the create form with inline choices and 创建 off until there is a name', () => {
    adminCache.mutate(CHANNELS_KEY, () => channels);
    const html = render(ChannelsSection, '/admin/channels/new');
    const page = text(html);
    expect(page).toContain('图标（选填）');
    expect(page).toContain('简介（选填）');
    expect(page).toContain('谁能看到');
    expect(page).toContain('谁能发言');
    expect(page).toContain('新成员可查看历史消息');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>创建<\/button>/);
  });

  it('sends unknown addresses under a channel back to the list', () => {
    adminCache.mutate(CHANNELS_KEY, () => channels);
    expect(text(render(ChannelsSection, '/admin/channels/ch_a/bogus'))).not.toContain('频道设置');
  });
});

describe('settings back target', () => {
  it('returns to chat info in one step when chat info opened the settings', () => {
    // Chat info pushes the old ?tab= link, which the shell replaces with the channel's settings.
    // 聊天信息压入旧的 ?tab= 链接，框架再把它替换为频道设置。
    const history = new AdminHistory();
    history.record('k1', '/admin?tab=channels&channel=ch_a', 'PUSH');
    history.record('k2', '/admin/channels/ch_a', 'REPLACE');
    const back = settingsBackTarget('ch_a', history.enteredFromOutside('k2'));
    expect(back).toEqual({ to: '/chat/room/channel%3Ach_a/info', label: { zh: '聊天信息', en: 'Chat info' } });
    // Outside admin, so useAdminBack pops this entry instead of replacing it.
    // 位于管理后台之外，useAdminBack 因此弹出这条记录，而不是替换它。
    expect(isAdminPath(back.to)).toBe(false);
  });

  it('returns to the list, with its query, when the list opened them', () => {
    const history = new AdminHistory();
    history.record('k1', '/admin/channels?f=custom', 'PUSH');
    history.record('k2', '/admin/channels/ch_a?f=custom', 'PUSH');
    expect(settingsBackTarget('ch_a', history.enteredFromOutside('k2'), '?f=custom')).toEqual({ to: '/admin/channels?f=custom', label: { zh: '频道', en: 'Channels' } });
  });
});


describe('channel icon row', () => {
  beforeEach(() => {
    const error = console.error;
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      if (String(args[0]).includes('useLayoutEffect does nothing on the server')) return;
      error(...args);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    held.session = { token: null, member: null, mediaToken: null };
  });

  it('is a button for managers and static for everyone else', () => {
    held.session = { token: 'tok', member: self('president'), mediaToken: 'mt' };
    const manage = renderToStaticMarkup(createElement(ChannelIconEditor, { channelId: 'ch_a', iconKey: 'preset:tech', canManage: true, name: '科技', onChange: () => undefined }));
    expect(manage).toMatch(/<button[^>]*aria-haspopup="dialog"/);
    expect(manage).toContain('channel-icons/tech.svg');
    const view = renderToStaticMarkup(createElement(ChannelIconEditor, { channelId: 'ch_a', iconKey: null, canManage: false, name: '科技', onChange: () => undefined }));
    expect(view).not.toContain('<button');
    expect(view).toContain('频道图标');
    expect(view).toContain('科');
  });

  it('shows an upload through the media route once there is a token', () => {
    held.session = { token: 'tok', member: self('president'), mediaToken: 'mt' };
    const html = renderToStaticMarkup(
      createElement(ChannelIconEditor, { channelId: 'ch_a', iconKey: 'channel-icon/ch_a/cic_AAAAAAAAAAAAAAAA.webp', canManage: true, name: '学术', onChange: () => undefined }),
    );
    expect(html).toContain('members/media/channel-icon%2Fch_a%2Fcic_AAAAAAAAAAAAAAAA-96.webp?t=mt 96w');
  });
});
