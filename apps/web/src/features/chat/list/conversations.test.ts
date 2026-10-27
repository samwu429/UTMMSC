import { describe, expect, it } from 'vitest';
import type { ChannelSummary, ChatOverviewResponse, ChatPrefs, DirectConversationSummary, LastMessagePreview } from '@utmmsc/shared';
import type { Translate } from '../format/systemText';
import type { ChatDraft } from '../state/drafts';
import { badgeFor, buildConversations, highlightParts, isHiddenRoom, matchesQuery, reuseConversations, searchConversations, type Conversation } from './conversations';

const zh: Translate = (text) => text;
const en: Translate = (_zh, text) => text;

const ME = 'mem_me';
/** 2026-10-22 14:32 local time; every message below is on the same day. */
/** 本地时间 2026-10-22 14:32；下面的消息都在同一天。 */
const NOW = new Date(2026, 9, 22, 14, 32).getTime();

function at(hours: number, minutes = 0): string {
  return new Date(2026, 9, 22, hours, minutes).toISOString();
}

function prefs(extra: Partial<ChatPrefs> = {}): ChatPrefs {
  return { pinned: false, muted: false, markedUnread: false, hiddenAt: null, ...extra };
}

function message(extra: Partial<LastMessagePreview> = {}): LastMessagePreview {
  return { id: 10, kind: 'text', authorId: 'mem_zhang', authorName: '张三', text: '你好', at: at(10), system: null, ...extra };
}

function channel(id: string, extra: Partial<ChannelSummary> = {}): ChannelSummary {
  return {
    id,
    slug: id,
    name: `频道${id}`,
    description: null,
    audience: 'all',
    postPolicy: 'members',
    unreadCount: 0,
    lastMessageAt: null,
    lastMessage: null,
    joinedAt: null,
    mentionedMe: false,
    prefs: prefs(),
    historyVisibility: 'since_join',
    ...extra,
  };
}

function direct(id: string, extra: Partial<DirectConversationSummary> = {}): DirectConversationSummary {
  return {
    id,
    peer: { id: `mem_${id}`, displayName: `Peer ${id}`, role: 'student', enrollmentStatus: 'student', graduationYear: 2024, avatarKey: null },
    lastMessageAt: null,
    lastPreview: null,
    unreadCount: 0,
    lastMessage: null,
    mentionedMe: false,
    prefs: prefs(),
    ...extra,
  };
}

function overview(channels: ChannelSummary[], dms: DirectConversationSummary[] = []): ChatOverviewResponse {
  return { channels, direct: dms };
}

function build(data: ChatOverviewResponse, drafts: Record<string, ChatDraft> = {}, tr: Translate = zh): Conversation[] {
  return buildConversations(data, drafts, ME, NOW, tr, tr === en ? 'en' : 'zh');
}

function rowOf(rows: Conversation[], roomId: string): Conversation {
  const row = rows.find((item) => item.roomId === roomId);
  if (!row) throw new Error(`missing ${roomId}`);
  return row;
}

describe('buildConversations: merge and sort', () => {
  it('mixes channels and direct messages by newest activity, with pinned rows first', () => {
    const rows = build(
      overview(
        [
          channel('a', { lastMessage: message({ at: at(9) }), lastMessageAt: at(9) }),
          channel('b', { lastMessage: message({ at: at(12) }), lastMessageAt: at(12) }),
          channel('pin', { lastMessage: message({ at: at(8) }), lastMessageAt: at(8), prefs: prefs({ pinned: true }) }),
        ],
        [direct('d', { lastMessage: message({ at: at(11), authorId: 'mem_d', authorName: 'Peer d' }), lastMessageAt: at(11) })],
      ),
    );
    expect(rows.map((row) => row.roomId)).toEqual(['channel:pin', 'channel:b', 'direct:d', 'channel:a']);
    expect(rows[0]?.pinned).toBe(true);
  });

  it('falls back to lastMessageAt, then joinedAt, and puts rooms with no activity last by title', () => {
    const rows = build(
      overview([
        channel('z', { name: 'Zeta' }),
        channel('y', { name: 'Alpha' }),
        channel('joined', { joinedAt: at(13) }),
        channel('legacy', { lastMessage: undefined, lastMessageAt: at(12) }),
      ]),
    );
    expect(rows.map((row) => row.roomId)).toEqual(['channel:joined', 'channel:legacy', 'channel:y', 'channel:z']);
    expect(rowOf(rows, 'channel:joined').timeLabel).toBe('13:00');
    expect(rowOf(rows, 'channel:z').timeLabel).toBe('');
  });

  it('returns nothing without data', () => {
    expect(buildConversations(null, {}, ME, NOW, zh)).toEqual([]);
  });
});

describe('buildConversations: avatars', () => {
  const UPLOAD = 'channel-icon/ch_a/cic_AAAAAAAAAAAAAAAA.webp';

  it('carries the channel icon, and the text tile for a channel without one', () => {
    const rows = build(overview([channel('a', { iconKey: UPLOAD }), channel('p', { iconKey: 'preset:events' }), channel('n', { iconKey: null })]));
    expect(rowOf(rows, 'channel:a').avatar).toEqual({ kind: 'channel', name: '频道a', iconKey: UPLOAD });
    expect(rowOf(rows, 'channel:p').avatar).toEqual({ kind: 'channel', name: '频道p', iconKey: 'preset:events' });
    expect(rowOf(rows, 'channel:n').avatar).toEqual({ kind: 'channel', name: '频道n', iconKey: null });
  });

  it('reads a server that does not send iconKey yet as no icon', () => {
    const legacy = channel('old');
    delete legacy.iconKey;
    expect(rowOf(build(overview([legacy])), 'channel:old').avatar).toEqual({ kind: 'channel', name: '频道old', iconKey: null });
  });

  it("gives direct messages the peer's photo", () => {
    const rows = build(overview([], [direct('d', { peer: { id: 'mem_d', displayName: 'Peer d', role: 'student', enrollmentStatus: 'student', graduationYear: 2024, avatarKey: 'avatar/mem_d/x.jpg' } })]));
    expect(rowOf(rows, 'direct:d').avatar).toEqual({ kind: 'direct', name: 'Peer d', avatarKey: 'avatar/mem_d/x.jpg' });
  });
});

describe('buildConversations: hidden rows', () => {
  it('leaves out a row hidden at or after its newest message', () => {
    const rows = build(
      overview([
        channel('same', { lastMessage: message({ at: at(10) }), prefs: prefs({ hiddenAt: at(10) }) }),
        channel('after', { lastMessage: message({ at: at(10) }), prefs: prefs({ hiddenAt: at(11) }) }),
        channel('empty', { lastMessage: null, prefs: prefs({ hiddenAt: at(9) }) }),
      ]),
    );
    expect(rows).toEqual([]);
  });

  it('brings a hidden row back when a newer message arrives', () => {
    const rows = build(overview([channel('back', { lastMessage: message({ at: at(12) }), prefs: prefs({ hiddenAt: at(11) }) })]));
    expect(rows.map((row) => row.roomId)).toEqual(['channel:back']);
    expect(isHiddenRoom(prefs({ hiddenAt: at(11) }), message({ at: at(12) }))).toBe(false);
    expect(isHiddenRoom(prefs(), null)).toBe(false);
  });
});

describe('buildConversations: preview priority', () => {
  const draft: ChatDraft = { text: '还没\n写完', quote: null, updatedAt: at(14) };
  const drafts = { [`${ME}|channel:c`]: draft, [`${ME}|direct:d`]: draft };

  it('puts [有人@我] before the draft when the mention is still unread', () => {
    const rows = build(overview([channel('c', { unreadCount: 2, mentionedMe: true, lastMessage: message() })]), drafts);
    expect(rowOf(rows, 'channel:c').preview).toEqual({ tag: { text: '[有人@我]', tone: 'alert' }, text: '张三: 你好' });
  });

  it('ignores a mention that has been read', () => {
    const rows = build(overview([channel('c', { unreadCount: 0, mentionedMe: true, lastMessage: message() })]), drafts);
    expect(rowOf(rows, 'channel:c').preview).toEqual({ tag: { text: '[草稿]', tone: 'alert' }, text: '还没 写完' });
  });

  it('shows the draft before the muted count', () => {
    const rows = build(overview([channel('c', { unreadCount: 3, lastMessage: message(), prefs: prefs({ muted: true }) })]), drafts);
    expect(rowOf(rows, 'channel:c').preview.tag).toEqual({ text: '[草稿]', tone: 'alert' });
  });

  it('shows [N条] in gray for a muted chat with unread', () => {
    const data = overview([channel('m', { unreadCount: 3, lastMessage: message(), prefs: prefs({ muted: true }) })]);
    expect(rowOf(build(data), 'channel:m').preview).toEqual({ tag: { text: '[3条]', tone: 'meta' }, text: '张三: 你好' });
    expect(rowOf(build(data, {}, en), 'channel:m').preview).toEqual({ tag: { text: '[3 msgs]', tone: 'meta' }, text: '张三: 你好' });
  });

  it('only shows drafts of the signed-in member', () => {
    const rows = build(overview([channel('c', { lastMessage: message() })]), { 'mem_other|channel:c': draft });
    expect(rowOf(rows, 'channel:c').preview).toEqual({ tag: null, text: '张三: 你好' });
  });
});

describe('buildConversations: sender prefix and bodies', () => {
  it('adds the sender only in channels and never for your own messages', () => {
    const rows = build(
      overview(
        [
          channel('other', { lastMessage: message() }),
          channel('own', { lastMessage: message({ authorId: ME, authorName: 'Me' }) }),
          channel('photo', { lastMessage: message({ kind: 'image', text: '' }) }),
        ],
        [direct('d', { lastMessage: message({ authorId: 'mem_d', authorName: 'Peer d', text: 'hi' }) })],
      ),
    );
    expect(rowOf(rows, 'channel:other').preview.text).toBe('张三: 你好');
    expect(rowOf(rows, 'channel:own').preview.text).toBe('你好');
    expect(rowOf(rows, 'channel:photo').preview.text).toBe('张三: [图片]');
    expect(rowOf(rows, 'direct:d').preview.text).toBe('hi');
  });

  it('labels stickers, with the sender in channels, in the member language', () => {
    const sticker = (extra: Partial<LastMessagePreview> = {}) => message({ kind: 'sticker', text: '[表情]', ...extra });
    const data = overview(
      [channel('other', { lastMessage: sticker() }), channel('own', { lastMessage: sticker({ authorId: ME, authorName: 'Me' }) })],
      [direct('d', { lastMessage: sticker({ authorId: 'mem_d', authorName: 'Peer d' }) })],
    );
    const rows = build(data);
    expect(rowOf(rows, 'channel:other').preview.text).toBe('张三: [表情]');
    expect(rowOf(rows, 'channel:own').preview.text).toBe('[表情]');
    expect(rowOf(rows, 'direct:d').preview.text).toBe('[表情]');
    const english = build(data, {}, en);
    expect(rowOf(english, 'channel:other').preview.text).toBe('张三: [Sticker]');
    expect(rowOf(english, 'direct:d').preview.text).toBe('[Sticker]');
    // An old server's DM preview carries the stored fallback text.
    // 旧服务端的私聊预览带有已保存的后备文字。
    expect(rowOf(build(overview([], [direct('old', { lastMessage: undefined, lastPreview: '[表情]' })])), 'direct:old').preview.text).toBe('[表情]');
  });

  it('words recalls for the viewer and never shows the original text', () => {
    const data = overview([
      channel('mine', { lastMessage: message({ kind: 'recalled', authorId: ME, authorName: 'Me', text: '' }) }),
      channel('theirs', { lastMessage: message({ kind: 'recalled', text: '' }) }),
    ]);
    const rows = build(data);
    expect(rowOf(rows, 'channel:mine').preview.text).toBe('你撤回了一条消息');
    expect(rowOf(rows, 'channel:theirs').preview.text).toBe('“张三” 撤回了一条消息');
    expect(rowOf(build(data, {}, en), 'channel:theirs').preview.text).toBe('“张三” recalled a message');
  });

  it('covers deletes, system rows and empty rooms', () => {
    const rows = build(
      overview(
        [
          channel('mod', { lastMessage: message({ kind: 'moderator_deleted', text: '' }) }),
          channel('old', { lastMessage: message({ kind: 'deleted', text: '' }) }),
          channel('join', {
            lastMessage: message({ kind: 'system', authorId: 'system', authorName: '', text: '', system: { type: 'join', actor: { id: 'mem_a', displayName: 'A' }, members: [{ id: ME, displayName: 'Me' }], more: 0 } }),
          }),
          channel('joined', { joinedAt: at(9) }),
          channel('described', { description: '所有在校生' }),
          channel('blank'),
        ],
        [direct('new')],
      ),
    );
    expect(rowOf(rows, 'channel:mod').preview.text).toBe('管理员删除了一条消息');
    expect(rowOf(rows, 'channel:old').preview.text).toBe('一条消息已被删除');
    expect(rowOf(rows, 'channel:join').preview.text).toBe('“A”邀请你加入了频道');
    expect(rowOf(rows, 'channel:joined').preview.text).toBe('你已加入频道');
    expect(rowOf(rows, 'channel:described').preview.text).toBe('所有在校生');
    expect(rowOf(rows, 'channel:blank').preview.text).toBe('暂无消息');
    expect(rowOf(rows, 'direct:new').preview.text).toBe('开始聊天');
  });

  it('uses the legacy direct preview only when the server sent no lastMessage', () => {
    const rows = build(overview([], [direct('old', { lastMessage: undefined, lastPreview: '[图片]' }), direct('none', { lastPreview: '旧文字' })]));
    expect(rowOf(rows, 'direct:old').preview.text).toBe('[图片]');
    expect(rowOf(rows, 'direct:none').preview.text).toBe('开始聊天');
  });
});

describe('badges', () => {
  it('shows counts for normal chats and dots for muted or marked chats', () => {
    expect(badgeFor(5, prefs())).toEqual({ type: 'count', n: 5 });
    expect(badgeFor(0, prefs())).toBeNull();
    expect(badgeFor(0, prefs({ markedUnread: true }))).toEqual({ type: 'dot' });
    expect(badgeFor(5, prefs({ muted: true }))).toEqual({ type: 'dot' });
    expect(badgeFor(0, prefs({ muted: true }))).toBeNull();
    expect(badgeFor(0, prefs({ muted: true, markedUnread: true }))).toEqual({ type: 'dot' });
  });

  it('marks muted rows in the built list', () => {
    const rows = build(overview([channel('m', { unreadCount: 4, lastMessage: message(), prefs: prefs({ muted: true }) })]));
    expect(rowOf(rows, 'channel:m')).toMatchObject({ muted: true, badge: { type: 'dot' }, unreadCount: 4 });
  });
});

describe('reuseConversations', () => {
  it('keeps unchanged rows and the same array when nothing changed', () => {
    const data = overview([channel('a', { lastMessage: message() }), channel('b', { lastMessage: message({ at: at(9) }) })]);
    const first = build(data);
    const second = build(data);
    expect(reuseConversations(first, second)).toBe(first);

    const changed = build(overview([channel('a', { lastMessage: message(), unreadCount: 1 }), channel('b', { lastMessage: message({ at: at(9) }) })]));
    const merged = reuseConversations(first, changed);
    expect(merged).not.toBe(first);
    expect(merged[0]).not.toBe(first[0]);
    expect(merged[1]).toBe(first[1]);
  });

  it('draws a row again when its channel icon changes, and only then', () => {
    const before = build(overview([channel('a', { lastMessage: message() }), channel('b', { lastMessage: message({ at: at(9) }), iconKey: 'preset:chat' })]));
    const same = build(overview([channel('a', { lastMessage: message() }), channel('b', { lastMessage: message({ at: at(9) }), iconKey: 'preset:chat' })]));
    expect(reuseConversations(before, same)).toBe(before);

    const uploaded = build(overview([channel('a', { lastMessage: message(), iconKey: 'preset:tech' }), channel('b', { lastMessage: message({ at: at(9) }), iconKey: 'preset:chat' })]));
    const merged = reuseConversations(before, uploaded);
    expect(merged[0]).not.toBe(before[0]);
    expect(merged[0]?.avatar).toEqual({ kind: 'channel', name: '频道a', iconKey: 'preset:tech' });
    expect(merged[1]).toBe(before[1]);

    const restored = reuseConversations(merged, build(overview([channel('a', { lastMessage: message() }), channel('b', { lastMessage: message({ at: at(9) }) })])));
    expect(restored[0]?.avatar).toEqual({ kind: 'channel', name: '频道a', iconKey: null });
    expect(restored[1]).not.toBe(merged[1]);
  });

  it("draws a direct row again when the peer's photo changes", () => {
    const peer = (avatarKey: string | null) => ({ id: 'mem_d', displayName: 'Peer d', role: 'student' as const, enrollmentStatus: 'student' as const, graduationYear: 2024, avatarKey });
    const before = build(overview([], [direct('d', { peer: peer(null) })]));
    expect(reuseConversations(before, build(overview([], [direct('d', { peer: peer(null) })])))).toBe(before);
    const after = reuseConversations(before, build(overview([], [direct('d', { peer: peer('avatar/mem_d/y.jpg') })])));
    expect(after[0]).not.toBe(before[0]);
  });
});

describe('search helpers', () => {
  it('matches without case and splits highlights', () => {
    expect(matchesQuery('Board Room', 'room')).toBe(true);
    expect(matchesQuery('Board Room', '  ')).toBe(false);
    expect(highlightParts('Room of rooms', 'room')).toEqual([
      { text: 'Room', match: true },
      { text: ' of ', match: false },
      { text: 'room', match: true },
      { text: 's', match: false },
    ]);
    expect(highlightParts('全体成员', '成员')).toEqual([
      { text: '全体', match: false },
      { text: '成员', match: true },
    ]);
    expect(highlightParts('abc', 'x')).toEqual([{ text: 'abc', match: false }]);
  });

  it('searches channel and peer names, including hidden chats', () => {
    const data = overview(
      [
        channel('a', { name: 'Board room', lastMessage: message({ at: at(9) }) }),
        channel('b', { name: 'Study ROOM', lastMessage: message({ at: at(11) }), prefs: prefs({ hiddenAt: at(12) }), iconKey: 'preset:academic' }),
        channel('c', { name: 'Events' }),
      ],
      [direct('d', { peer: { id: 'mem_d', displayName: 'Roomie', role: 'student', enrollmentStatus: 'student', graduationYear: 2024, avatarKey: 'k' } })],
    );
    expect(searchConversations(data, 'room').map((item) => item.roomId)).toEqual(['channel:b', 'channel:a', 'direct:d']);
    expect(searchConversations(data, 'room')[2]?.avatar).toEqual({ kind: 'direct', name: 'Roomie', avatarKey: 'k' });
    expect(searchConversations(data, 'room')[1]?.avatar).toEqual({ kind: 'channel', name: 'Board room', iconKey: null });
    expect(searchConversations(data, 'room')[0]?.avatar).toEqual({ kind: 'channel', name: 'Study ROOM', iconKey: 'preset:academic' });
    expect(searchConversations(data, ' ')).toEqual([]);
    expect(searchConversations(null, 'room')).toEqual([]);
  });
});
