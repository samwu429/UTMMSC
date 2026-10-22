import { describe, expect, it } from 'vitest';
import { parseClientFrame, parseServerFrame } from './protocol';

describe('parseClientFrame', () => {
  it('parses a valid send frame and drops unknown fields', () => {
    const frame = parseClientFrame({ type: 'send', clientId: 'abc', text: 'hi', extra: 1 });
    expect(frame).toEqual({ type: 'send', clientId: 'abc', text: 'hi' });
  });

  it('keeps imageKey when provided as a string', () => {
    expect(parseClientFrame({ type: 'send', clientId: 'a', text: '', imageKey: 'k' })).toEqual({
      type: 'send',
      clientId: 'a',
      text: '',
      imageKey: 'k',
    });
  });

  it('rejects oversized image keys and mute targets', () => {
    expect(parseClientFrame({ type: 'send', clientId: 'a', text: '', imageKey: 'k'.repeat(201) })).toBeNull();
    expect(parseClientFrame({ type: 'mute', memberId: '', minutes: 10 })).toBeNull();
    expect(parseClientFrame({ type: 'mute', memberId: 'm'.repeat(65), minutes: 10 })).toBeNull();
    expect(parseClientFrame({ type: 'mute', memberId: 'mem_1', minutes: 10 })).toEqual({ type: 'mute', memberId: 'mem_1', minutes: 10 });
  });

  it('rejects send frames with missing or malformed fields', () => {
    expect(parseClientFrame({ type: 'send', text: 'hi' })).toBeNull();
    expect(parseClientFrame({ type: 'send', clientId: '', text: 'hi' })).toBeNull();
    expect(parseClientFrame({ type: 'send', clientId: 'a', text: 1 })).toBeNull();
    expect(parseClientFrame({ type: 'send', clientId: 'a', text: 'x', imageKey: 2 })).toBeNull();
  });

  it('parses history with and without a cursor', () => {
    expect(parseClientFrame({ type: 'history' })).toEqual({ type: 'history' });
    expect(parseClientFrame({ type: 'history', beforeId: 10 })).toEqual({ type: 'history', beforeId: 10 });
    expect(parseClientFrame({ type: 'history', beforeId: 0 })).toBeNull();
    expect(parseClientFrame({ type: 'history', beforeId: '10' })).toBeNull();
  });

  it('requires positive integer ids for read, delete, and recall', () => {
    expect(parseClientFrame({ type: 'read', messageId: 3 })).toEqual({ type: 'read', messageId: 3 });
    expect(parseClientFrame({ type: 'delete', messageId: -1 })).toBeNull();
    expect(parseClientFrame({ type: 'read', messageId: 1.5 })).toBeNull();
    expect(parseClientFrame({ type: 'recall', messageId: 4 })).toEqual({ type: 'recall', messageId: 4 });
    expect(parseClientFrame({ type: 'recall', messageId: 0 })).toBeNull();
    expect(parseClientFrame({ type: 'recall' })).toBeNull();
  });

  it('accepts a recall notice that carries no message body', () => {
    expect(parseServerFrame({ type: 'recalled', messageId: 4 })).toMatchObject({ type: 'recalled', messageId: 4 });
  });

  it('bounds mute duration to thirty days', () => {
    expect(parseClientFrame({ type: 'mute', memberId: 'm', minutes: 60 })).toEqual({
      type: 'mute',
      memberId: 'm',
      minutes: 60,
    });
    expect(parseClientFrame({ type: 'mute', memberId: 'm', minutes: 60 * 24 * 31 })).toBeNull();
  });

  it('rejects non-objects and unknown types', () => {
    expect(parseClientFrame(null)).toBeNull();
    expect(parseClientFrame('send')).toBeNull();
    expect(parseClientFrame([])).toBeNull();
    expect(parseClientFrame({ type: 'shout' })).toBeNull();
  });
});
