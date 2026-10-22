import { describe, expect, it } from 'vitest';
import { conversationPreview, lastMessagePreview, parseSystemEvent, type PreviewRow } from './preview';

describe('conversationPreview', () => {
  it('does not keep the original text of a withdrawn message', () => {
    const preview = conversationPreview({ text: 'secret phrase', hasImage: true, deleted: false, recalled: true });
    expect(preview).toBe('撤回了一条消息');
    expect(preview).not.toContain('secret');
  });

  it('drops deleted text and still previews a live message', () => {
    expect(conversationPreview({ text: 'secret', hasImage: false, deleted: true, recalled: false })).toBe('');
    expect(conversationPreview({ text: 'hello', hasImage: false, deleted: false, recalled: false })).toBe('hello');
  });
});

const row: PreviewRow = {
  id: 7,
  kind: 'user',
  author_id: 'mem_a',
  author_name: 'A',
  text: 'secret words',
  image_key: null,
  created_at: '2026-10-21T10:00:00.000Z',
  deleted: 0,
  recalled: 0,
  deleted_by: null,
  system_json: null,
};

describe('lastMessagePreview', () => {
  it('collapses whitespace and caps text at 80 characters', () => {
    expect(lastMessagePreview({ ...row, text: '  hello \n  world ' })).toMatchObject({ kind: 'text', text: 'hello world', authorName: 'A', at: row.created_at });
    const long = lastMessagePreview({ ...row, text: 'x'.repeat(200) });
    expect(long.text).toHaveLength(80);
    expect(long.text.endsWith('…')).toBe(true);
  });

  it('labels an image without text', () => {
    expect(lastMessagePreview({ ...row, text: '', image_key: 'chat/a.png' })).toMatchObject({ kind: 'image', text: '' });
  });

  it('never carries recalled or deleted text', () => {
    const recalled = lastMessagePreview({ ...row, recalled: 1 });
    expect(recalled).toMatchObject({ kind: 'recalled', text: '' });
    const moderated = lastMessagePreview({ ...row, deleted: 1, deleted_by: 'moderator' });
    expect(moderated).toMatchObject({ kind: 'moderator_deleted', text: '' });
    const legacy = lastMessagePreview({ ...row, deleted: 1, deleted_by: null });
    expect(legacy).toMatchObject({ kind: 'deleted', text: '' });
    for (const preview of [recalled, moderated, legacy]) expect(JSON.stringify(preview)).not.toContain('secret');
  });

  it('parses system rows', () => {
    const event = { type: 'join', actor: { id: 'mem_x', displayName: 'X' }, members: [{ id: 'mem_y', displayName: 'Y' }], more: 0 };
    const preview = lastMessagePreview({ ...row, kind: 'system', author_id: 'system', text: '“X”邀请“Y”加入了频道', system_json: JSON.stringify(event) });
    expect(preview).toEqual({ id: 7, kind: 'system', authorId: 'system', authorName: 'A', text: '', at: row.created_at, system: event });
  });
});

describe('parseSystemEvent', () => {
  it('returns null for missing or malformed JSON', () => {
    expect(parseSystemEvent(null)).toBeNull();
    expect(parseSystemEvent('{')).toBeNull();
    expect(parseSystemEvent('{"type":"leave"}')).toBeNull();
  });

  it('drops malformed members', () => {
    expect(parseSystemEvent('{"type":"join","actor":null,"members":[{"id":"a","displayName":"A"},{"x":1}],"more":-3}')).toEqual({
      type: 'join',
      actor: null,
      members: [{ id: 'a', displayName: 'A' }],
      more: 0,
    });
  });
});
