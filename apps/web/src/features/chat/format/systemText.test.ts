import { describe, expect, it } from 'vitest';
import type { SystemEvent } from '@utmmsc/shared';
import { imageLabel, joinText, legacyDeletedText, moderatorDeletedText, recallText, selfJoinTip, type Translate } from './systemText';

const zh: Translate = (text) => text;
const en: Translate = (_zh, text) => text;

const A = { id: 'mem_a', displayName: 'A' };
const B = { id: 'mem_b', displayName: 'B' };
const C = { id: 'mem_c', displayName: 'C' };
const D = { id: 'mem_d', displayName: 'D' };
const E = { id: 'mem_e', displayName: 'E' };

function join(extra: Partial<SystemEvent>): SystemEvent {
  return { type: 'join', actor: A, members: [B], more: 0, ...extra };
}

describe('recallText', () => {
  it('words the author and others differently', () => {
    expect(recallText({ own: true, name: 'Zhang San' }, zh)).toBe('你撤回了一条消息');
    expect(recallText({ own: true, name: 'Zhang San' }, en)).toBe('You recalled a message');
    expect(recallText({ own: false, name: '张三' }, zh)).toBe('“张三” 撤回了一条消息');
    expect(recallText({ own: false, name: 'Zhang San' }, en)).toBe('“Zhang San” recalled a message');
  });

  it('falls back when the name is blank', () => {
    expect(recallText({ own: false, name: '  ' }, zh)).toBe('有人撤回了一条消息');
    expect(recallText({ own: false, name: null }, en)).toBe('Someone recalled a message');
  });
});

describe('deleted tips', () => {
  it('distinguishes moderator and legacy deletes', () => {
    expect(moderatorDeletedText(zh)).toBe('管理员删除了一条消息');
    expect(moderatorDeletedText(en)).toBe('An admin removed a message');
    expect(legacyDeletedText(zh)).toBe('一条消息已被删除');
    expect(legacyDeletedText(en)).toBe('A message was deleted');
  });
});

describe('joinText', () => {
  it('tells the invited member that they were invited', () => {
    expect(joinText(join({ members: [B] }), 'mem_b', zh)).toBe('“A”邀请你加入了频道');
    expect(joinText(join({ members: [B] }), 'mem_b', en)).toBe('“A” invited you to the channel');
  });

  it('lists up to three names', () => {
    expect(joinText(join({ members: [B, C] }), 'mem_x', zh)).toBe('“A”邀请“B”、“C”加入了频道');
    expect(joinText(join({ members: [B, C] }), 'mem_x', en)).toBe('“A” invited “B” and “C” to the channel');
    expect(joinText(join({ members: [B, C, D] }), 'mem_x', zh)).toBe('“A”邀请“B”、“C”、“D”加入了频道');
    expect(joinText(join({ members: [B, C, D] }), 'mem_x', en)).toBe('“A” invited “B”, “C” and “D” to the channel');
  });

  it('counts the rest past three names or when more is set', () => {
    expect(joinText(join({ members: [B, C, D, E] }), 'mem_x', zh)).toBe('“A”邀请“B”、“C”、“D”等4人加入了频道');
    expect(joinText(join({ members: [B, C, D, E], more: 2 }), 'mem_x', en)).toBe('“A” invited “B”, “C”, “D” and 3 others to the channel');
    expect(joinText(join({ members: [B, C], more: 1 }), 'mem_x', zh)).toBe('“A”邀请“B”、“C”等3人加入了频道');
    expect(joinText(join({ members: [B, C, D, E] }), 'mem_x', en)).toBe('“A” invited “B”, “C”, “D” and 1 other to the channel');
  });

  it('words a join without an actor', () => {
    expect(joinText(join({ actor: null, members: [B] }), 'mem_x', zh)).toBe('“B”加入了频道');
    expect(joinText(join({ actor: null, members: [B] }), 'mem_x', en)).toBe('“B” joined the channel');
    expect(joinText(join({ actor: null, members: [B, C] }), 'mem_x', en)).toBe('“B” and “C” joined the channel');
  });

  it('words it for the inviter and for a viewer added with others', () => {
    expect(joinText(join({ members: [B] }), 'mem_a', zh)).toBe('你邀请“B”加入了频道');
    expect(joinText(join({ members: [B] }), 'mem_a', en)).toBe('You invited “B” to the channel');
    expect(joinText(join({ members: [B, C] }), 'mem_b', zh)).toBe('“A”邀请你和“C”加入了频道');
    expect(joinText(join({ members: [B, C] }), 'mem_b', en)).toBe('“A” invited you and “C” to the channel');
  });

  it('replaces blank names', () => {
    expect(joinText(join({ actor: { id: 'mem_a', displayName: ' ' }, members: [B] }), 'mem_x', zh)).toBe('“成员”邀请“B”加入了频道');
  });
});

describe('selfJoinTip', () => {
  it('names the channel when known', () => {
    expect(selfJoinTip('学术部', zh)).toBe('你已加入“学术部”');
    expect(selfJoinTip('Academics', en)).toBe('You joined “Academics”');
    expect(selfJoinTip(null, zh)).toBe('你已加入频道');
    expect(selfJoinTip('', en)).toBe('You joined this channel');
  });
});

describe('imageLabel', () => {
  it('is bracketed in both languages', () => {
    expect(imageLabel(zh)).toBe('[图片]');
    expect(imageLabel(en)).toBe('[Photo]');
  });
});
