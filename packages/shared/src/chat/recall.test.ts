import { describe, expect, it } from 'vitest';
import { RECALL_WINDOW_MS, decideRecall, redactChatBody, withinRecallWindow } from './recall';

const base = {
  authorId: 'mem_a',
  actorId: 'mem_a',
  createdAtMs: 1_000_000,
  nowMs: 1_000_000 + 60_000,
  deleted: false,
  recalled: false,
};

describe('decideRecall', () => {
  it('allows only the author inside three minutes', () => {
    expect(decideRecall(base)).toBe('ok');
    expect(decideRecall({ ...base, nowMs: base.createdAtMs + RECALL_WINDOW_MS })).toBe('ok');
  });

  it('rejects other people even inside the window', () => {
    expect(decideRecall({ ...base, actorId: 'mem_b', nowMs: base.createdAtMs + 1_000 })).toBe('not_author');
  });

  it('rejects recalls after the window', () => {
    expect(decideRecall({ ...base, nowMs: base.createdAtMs + RECALL_WINDOW_MS + 1 })).toBe('expired');
    expect(decideRecall({ ...base, createdAtMs: Number.NaN })).toBe('expired');
  });

  it('rejects deleted or already recalled messages', () => {
    expect(decideRecall({ ...base, deleted: true })).toBe('unavailable');
    expect(decideRecall({ ...base, recalled: true })).toBe('unavailable');
  });
});

describe('withinRecallWindow', () => {
  it('matches the server window on an ISO timestamp', () => {
    const created = new Date(base.createdAtMs).toISOString();
    expect(withinRecallWindow(created, base.createdAtMs + RECALL_WINDOW_MS)).toBe(true);
    expect(withinRecallWindow(created, base.createdAtMs + RECALL_WINDOW_MS + 1)).toBe(false);
    expect(withinRecallWindow('not-a-date', base.nowMs)).toBe(false);
  });
});

describe('redactChatBody', () => {
  it('strips text and image after recall or delete', () => {
    expect(redactChatBody({ text: 'secret', imageKey: 'chat/a', deleted: false, recalled: true })).toEqual({
      text: '',
      imageKey: null,
      deleted: false,
      recalled: true,
    });
    expect(redactChatBody({ text: 'secret', imageKey: null, deleted: true, recalled: false }).text).toBe('');
  });

  it('leaves a live message untouched', () => {
    const live = { text: 'hi', imageKey: null, deleted: false, recalled: false };
    expect(redactChatBody(live)).toBe(live);
  });
});
