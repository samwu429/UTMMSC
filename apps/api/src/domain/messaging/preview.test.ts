import { describe, expect, it } from 'vitest';
import { conversationPreview } from './preview';

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
