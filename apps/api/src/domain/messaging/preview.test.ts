import { describe, expect, it } from 'vitest';
import { conversationPreview, lastMessagePreview, parseSystemEvent, previewOf, type PreviewRow } from './preview';

const STICKER_JSON = JSON.stringify({ id: 'stk_0123456789abcdefghijkl', type: 'gif', width: 240, height: 240, animated: true, bytes: 182044, thumb: null });

describe('previewOf', () => {
  it('labels a sticker [表情] whatever its stored text', () => {
    expect(previewOf('[表情]', false, true)).toBe('[表情]');
    expect(previewOf('', false, true)).toBe('[表情]');
    expect(previewOf('', true)).toBe('[图片]');
    expect(previewOf('hi', false)).toBe('hi');
  });
});

describe('conversationPreview', () => {
  it('gives a DM list [表情] for a sticker, and the recall line once it is withdrawn', () => {
    expect(conversationPreview({ text: '', hasImage: false, hasSticker: true, deleted: false, recalled: false })).toBe('[表情]');
    expect(conversationPreview({ text: '', hasImage: false, hasSticker: false, deleted: false, recalled: true })).toBe('撤回了一条消息');
  });

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

  it('gives a sticker its own kind with [表情] as the text', () => {
    expect(lastMessagePreview({ ...row, text: '[表情]', sticker_json: STICKER_JSON })).toEqual({
      id: 7,
      kind: 'sticker',
      authorId: 'mem_a',
      authorName: 'A',
      text: '[表情]',
      at: row.created_at,
      system: null,
    });
  });

  it('reads a withdrawn sticker as withdrawn, also when an old Worker left its sticker_json behind', () => {
    expect(lastMessagePreview({ ...row, text: '', recalled: 1, sticker_json: STICKER_JSON })).toMatchObject({ kind: 'recalled', text: '' });
    expect(lastMessagePreview({ ...row, text: '', deleted: 1, deleted_by: 'moderator', sticker_json: STICKER_JSON })).toMatchObject({
      kind: 'moderator_deleted',
      text: '',
    });
    expect(lastMessagePreview({ ...row, text: '', deleted: 1, deleted_by: 'author', sticker_json: null })).toMatchObject({ kind: 'deleted' });
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
