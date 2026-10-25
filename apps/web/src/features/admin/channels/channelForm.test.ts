import { describe, expect, it } from 'vitest';
import { CHANNEL_AUDIENCES, type AdminChannelRow } from '@utmmsc/shared';
import {
  AUDIENCE_ORDER,
  addedMembers,
  audienceChoice,
  channelFilterCounts,
  channelPatch,
  channelSearchText,
  channelsPath,
  createChannelBody,
  draftOf,
  emptyChannelDraft,
  isChannelScreen,
  isEmptyPatch,
  isNarrowing,
  isValidChannelName,
  matchesChannelFilter,
  matchesChannelQuery,
  memberPickerSave,
  newChannelPath,
  readChannelFilter,
  removedMembers,
  sortChannels,
} from './channelForm';

function channel(id: string, extra: Partial<AdminChannelRow> = {}): AdminChannelRow {
  return {
    id,
    slug: id,
    name: `频道 ${id}`,
    description: null,
    audience: 'all',
    postPolicy: 'members',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastMessageAt: null,
    memberIds: [],
    historyVisibility: 'since_join',
    ...extra,
  };
}

describe('channel paths', () => {
  it('builds the list, item and screen addresses with the list query', () => {
    expect(channelsPath()).toBe('/admin/channels');
    expect(channelsPath(null, null, '?q=a')).toBe('/admin/channels?q=a');
    expect(channelsPath('ch_1')).toBe('/admin/channels/ch_1');
    expect(channelsPath('ch 1', 'members', '?f=custom')).toBe('/admin/channels/ch%201/members?f=custom');
    expect(newChannelPath()).toBe('/admin/channels/new');
  });

  it('knows the screens and the filters', () => {
    expect(isChannelScreen('audience')).toBe(true);
    expect(isChannelScreen('icon')).toBe(false);
    expect(isChannelScreen(undefined)).toBe(false);
    expect(readChannelFilter('custom')).toBe('custom');
    expect(readChannelFilter('nope')).toBe('all');
    expect(readChannelFilter(null)).toBe('all');
  });
});

describe('list', () => {
  const list = [
    channel('a', { name: '学术交流', audience: 'student', description: '论文与课程' }),
    channel('b', { name: 'Tech', audience: 'custom', memberIds: ['m1'] }),
    channel('c', { name: '公告', audience: 'all' }),
  ];

  it('filters by audience kind and counts each chip', () => {
    expect(list.filter((item) => matchesChannelFilter(item, 'custom')).map((item) => item.id)).toEqual(['b']);
    expect(list.filter((item) => matchesChannelFilter(item, 'role')).map((item) => item.id)).toEqual(['a', 'c']);
    expect(channelFilterCounts(list)).toEqual({ all: 3, role: 2, custom: 1 });
  });

  it('searches name, description and the audience in both languages', () => {
    const text = channelSearchText(list[0]!);
    expect(matchesChannelQuery(text, '学术')).toBe(true);
    expect(matchesChannelQuery(text, '论文')).toBe(true);
    expect(matchesChannelQuery(text, 'STUDENTS')).toBe(true);
    expect(matchesChannelQuery(text, '在校生 课程')).toBe(true);
    expect(matchesChannelQuery(text, '学术 tech')).toBe(false);
    expect(matchesChannelQuery(text, '  ')).toBe(true);
  });

  it('puts the most recent activity first, creation time for channels without messages', () => {
    const sorted = sortChannels([
      channel('old', { lastMessageAt: '2026-03-01T00:00:00.000Z' }),
      channel('new', { lastMessageAt: '2026-05-01T00:00:00.000Z' }),
      channel('fresh', { createdAt: '2026-04-01T00:00:00.000Z' }),
      channel('quiet'),
    ]);
    expect(sorted.map((item) => item.id)).toEqual(['new', 'fresh', 'old', 'quiet']);
  });

  it('breaks ties by name and then id', () => {
    const sorted = sortChannels([channel('2', { name: 'B' }), channel('1', { name: 'A' }), channel('0', { name: 'A' })], 'en');
    expect(sorted.map((item) => item.id)).toEqual(['0', '1', '2']);
  });
});

describe('patch', () => {
  const base = channel('c', { name: '学术交流', description: '论文', audience: 'custom', memberIds: ['m1', 'm2'] });

  it('sends only the fields that changed', () => {
    expect(channelPatch(base, { name: '学术' })).toEqual({ name: '学术' });
    expect(channelPatch(base, { postPolicy: 'staff' })).toEqual({ postPolicy: 'staff' });
    expect(channelPatch(base, { historyVisibility: 'all' })).toEqual({ historyVisibility: 'all' });
  });

  it('sends nothing when a value is saved again', () => {
    expect(channelPatch(base, draftOf(base))).toEqual({});
    expect(isEmptyPatch(channelPatch(base, { name: '  学术交流 ' }))).toBe(true);
    expect(channelPatch(base, { description: ' 论文 ' })).toEqual({});
    expect(channelPatch(base, { historyVisibility: 'since_join' })).toEqual({});
    expect(channelPatch({ ...base, historyVisibility: undefined }, { historyVisibility: 'since_join' })).toEqual({});
  });

  it('trims the name and sends an emptied description as null', () => {
    expect(channelPatch(base, { name: ' 新名字 ' })).toEqual({ name: '新名字' });
    expect(channelPatch(base, { description: '   ' })).toEqual({ description: null });
    expect(channelPatch(channel('d'), { description: '' })).toEqual({});
  });

  it('sends the member list in full, only when the set changed', () => {
    expect(channelPatch(base, { memberIds: ['m2', 'm1'] })).toEqual({});
    expect(channelPatch(base, { memberIds: ['m1', 'm3', 'm3'] })).toEqual({ memberIds: ['m1', 'm3'] });
    expect(channelPatch(channel('e'), { memberIds: ['m1'] })).toEqual({});
    expect(channelPatch(channel('e'), { audience: 'custom', memberIds: ['m1'] })).toEqual({ audience: 'custom', memberIds: ['m1'] });
  });
});

describe('create body', () => {
  it('trims, leaves out an empty description and lists members only for custom channels', () => {
    expect(createChannelBody({ ...emptyChannelDraft(), name: ' 新频道 ', description: '  ' })).toEqual({
      name: '新频道',
      audience: 'all',
      postPolicy: 'members',
      historyVisibility: 'since_join',
    });
    expect(createChannelBody({ ...emptyChannelDraft(), name: 'x', audience: 'student', memberIds: ['m1'] }).memberIds).toBeUndefined();
    expect(createChannelBody({ ...emptyChannelDraft(), name: 'x', audience: 'custom', memberIds: ['m1', 'm1'] }).memberIds).toEqual(['m1']);
    expect(createChannelBody({ ...emptyChannelDraft(), name: 'x', description: ' 简介 ' }).description).toBe('简介');
  });

  it('checks the name', () => {
    expect(isValidChannelName('  ')).toBe(false);
    expect(isValidChannelName('学术')).toBe(true);
    expect(isValidChannelName('x'.repeat(41))).toBe(false);
    expect(isValidChannelName('x'.repeat(40))).toBe(true);
  });
});

describe('narrowing', () => {
  it('is false for the same audience and for a move to a group that holds the old one', () => {
    for (const audience of CHANNEL_AUDIENCES) {
      expect(isNarrowing(audience, audience)).toBe(false);
      expect(isNarrowing(audience, 'all')).toBe(false);
    }
    expect(isNarrowing('heads', 'staff')).toBe(false);
    expect(isNarrowing('officers', 'staff')).toBe(false);
  });

  it('is true for every other move', () => {
    expect(isNarrowing('all', 'student')).toBe(true);
    expect(isNarrowing('all', 'custom')).toBe(true);
    expect(isNarrowing('staff', 'heads')).toBe(true);
    expect(isNarrowing('student', 'alumni')).toBe(true);
    expect(isNarrowing('custom', 'staff')).toBe(true);
    expect(isNarrowing('honorary', 'staff')).toBe(true);
  });

  it('lists every audience on the choice screen', () => {
    expect([...AUDIENCE_ORDER].sort()).toEqual([...CHANNEL_AUDIENCES].sort());
  });
});

describe('member changes', () => {
  it('finds who is removed and who is added', () => {
    expect(removedMembers(['a', 'b', 'c'], ['b', 'd'])).toEqual(['a', 'c']);
    expect(addedMembers(['a', 'b', 'c'], ['b', 'd', 'd'])).toEqual(['d']);
    expect(removedMembers(['a'], ['a'])).toEqual([]);
  });
});

describe('switching to selected members', () => {
  const open = channel('o', { audience: 'all' });
  const custom = channel('k', { audience: 'custom', memberIds: ['a', 'b'] });

  it('saves nothing on 谁能看到 when an open channel picks 指定成员, and goes to the picker', () => {
    expect(audienceChoice(open, 'custom')).toBe('members');
    expect(audienceChoice(channel('s', { audience: 'student' }), 'custom')).toBe('members');
    expect(audienceChoice(open, 'student')).toBe('save');
    expect(audienceChoice(custom, 'all')).toBe('save');
  });

  it('sends the audience and the list in one body from the picker, after the narrowing question', () => {
    const plan = memberPickerSave(open, ['a', 'b']);
    expect(plan.ask).toBe('narrow');
    expect(channelPatch(open, plan.change)).toEqual({ audience: 'custom', memberIds: ['a', 'b'] });
  });

  it('saves only the list of a custom channel, asking when people are taken out', () => {
    expect(memberPickerSave(custom, ['a', 'b', 'c'])).toEqual({ change: { memberIds: ['a', 'b', 'c'] }, ask: null, removed: 0 });
    const taken = memberPickerSave(custom, ['a']);
    expect(taken.ask).toBe('remove');
    expect(taken.removed).toBe(1);
    expect(channelPatch(custom, taken.change)).toEqual({ memberIds: ['a'] });
  });
});
