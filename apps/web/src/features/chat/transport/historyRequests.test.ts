import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseClientFrame, type ChatMessage } from '@utmmsc/shared';
import { CATCH_UP_PAGES_MAX, HISTORY_TIMEOUT_MS, HistoryRequests, planCatchUp, planSync, type HistoryRequest } from './historyRequests';
import { createMessageStore, distrustRev, mergePage, newestId, oldestId, type MessageStoreState } from './messageStore';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function tracker() {
  const timedOut: HistoryRequest[] = [];
  let seq = 0;
  const requests = new HistoryRequests({ onTimeout: (r) => timedOut.push(r), makeRequestId: () => `r${++seq}` });
  return { requests, timedOut };
}

describe('HistoryRequests', () => {
  it('builds frames the server accepts', () => {
    const requests = new HistoryRequests({ onTimeout: () => undefined });
    const request = requests.start('catch_up', { afterId: 40, oldestId: 1, sinceRev: 7, limit: 50 });
    expect(request.frame.requestId).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
    expect(parseClientFrame(request.frame)).toEqual(request.frame);
  });

  it('unlocks on timeout and reports the lost request', () => {
    const { requests, timedOut } = tracker();
    const older = requests.start('older', { beforeId: 10, limit: 50 }, { lock: true });
    expect(requests.locked).toBe(true);
    vi.advanceTimersByTime(HISTORY_TIMEOUT_MS - 1);
    expect(requests.locked).toBe(true);
    vi.advanceTimersByTime(1);
    expect(requests.locked).toBe(false);
    expect(timedOut).toEqual([older]);
  });

  it('lets a stale result through without unlocking a newer request', () => {
    const { requests } = tracker();
    const first = requests.start('older', { beforeId: 10 }, { lock: true });
    vi.advanceTimersByTime(HISTORY_TIMEOUT_MS);
    const second = requests.start('older', { beforeId: 10 }, { lock: true });
    expect(requests.settle(first.requestId)).toBeNull();
    expect(requests.locked).toBe(true);
    expect(requests.settle(second.requestId)).toBe(second);
    expect(requests.locked).toBe(false);
    expect(requests.settle(undefined)).toBeNull();
  });

  it('keeps the sync lock until its holder releases it', () => {
    const { requests } = tracker();
    expect(requests.acquire('sync')).toBe(true);
    const catchUp = requests.start('catch_up', { afterId: 5 });
    expect(requests.settle(catchUp.requestId)).toBe(catchUp);
    expect(requests.locked).toBe(true);
    expect(requests.acquire('other')).toBe(false);
    requests.release('other');
    expect(requests.locked).toBe(true);
    requests.release('sync');
    expect(requests.locked).toBe(false);
  });

  it('drops everything when the socket closes', () => {
    const { requests, timedOut } = tracker();
    requests.acquire('sync');
    requests.start('catch_up', { afterId: 5 });
    expect(requests.isPending('catch_up')).toBe(true);
    expect(requests.cancelAll()).toHaveLength(1);
    expect(requests.locked).toBe(false);
    vi.advanceTimersByTime(HISTORY_TIMEOUT_MS * 2);
    expect(timedOut).toHaveLength(0);
  });
});

describe('planCatchUp', () => {
  it('resets when the changes overflow', () => {
    expect(planCatchUp({ page: 1, hasNewer: false, changedOverflow: true, cursor: 10 })).toEqual({ kind: 'reset' });
  });

  it('continues from the cursor, then resets after the page budget', () => {
    expect(planCatchUp({ page: 1, hasNewer: true, changedOverflow: false, cursor: 60 })).toEqual({ kind: 'next', afterId: 60, page: 2 });
    expect(planCatchUp({ page: CATCH_UP_PAGES_MAX - 1, hasNewer: true, changedOverflow: false, cursor: 60 }).kind).toBe('next');
    expect(planCatchUp({ page: CATCH_UP_PAGES_MAX, hasNewer: true, changedOverflow: false, cursor: 60 })).toEqual({ kind: 'reset' });
  });

  it('finishes when nothing newer is left', () => {
    expect(planCatchUp({ page: 3, hasNewer: false, changedOverflow: false, cursor: 60 })).toEqual({ kind: 'done' });
  });
});

function row(id: number, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id, roomId: 'channel:ch_test', author: { id: 'mem_a', displayName: 'Alice' }, text: `message ${id}`, imageKey: null, createdAt: '2026-01-01T00:00:00.000Z', deleted: false, recalled: false, ...extra };
}

function planFor(state: MessageStoreState, serverRev: number | undefined) {
  return planSync({ serverRev, newestId: newestId(state), oldestId: oldestId(state), lastRev: state.lastRev, revTrusted: state.revTrusted, limit: 50 });
}

describe('planSync', () => {
  it('keeps the old protocol for a ready without a revision', () => {
    expect(planFor(createMessageStore(), undefined)).toEqual({ kind: 'legacy' });
  });

  it('loads the first page into an empty list', () => {
    expect(planFor(createMessageStore(), 7)).toEqual({ kind: 'latest', purpose: 'initial', fields: { limit: 50 } });
  });

  it('catches up from a revision a capable server gave', () => {
    const state = mergePage(createMessageStore(), { messages: [row(3), row(4)], hasMore: false, rev: 12 }, 'latest');
    expect(state.revTrusted).toBe(true);
    expect(planFor(state, 15)).toEqual({ kind: 'catch_up', fields: { afterId: 4, oldestId: 3, sinceRev: 12, limit: 50 } });
  });

  it('never sends sinceRev for a list loaded from an old server', () => {
    // Rows an old server recalled keep revision 0 after the upgrade, so a catch-up from 0 would miss them.
    // 旧服务端撤回的消息在升级后版本号仍为 0，从 0 开始补齐会漏掉它们。
    const legacy = mergePage(createMessageStore(), { messages: [row(3), row(4, { text: 'my phone number' })], hasMore: false }, 'latest');
    expect(legacy.revTrusted).toBe(false);
    const plan = planFor(legacy, 0);
    expect(plan).toEqual({ kind: 'latest', purpose: 'reset', fields: { limit: 50 } });
    expect(plan.kind === 'catch_up' ? plan.fields.sinceRev : undefined).toBeUndefined();
  });

  it('reloads a cached list whose session met an old server, and one the server revision fell behind', () => {
    const trusted = mergePage(createMessageStore(), { messages: [row(3)], hasMore: false, rev: 20 }, 'latest');
    expect(planFor(distrustRev(trusted), 25).kind).toBe('latest');
    const snapshot = createMessageStore({ messages: trusted.messages, lastRev: 20 });
    expect(planFor(snapshot, 25).kind).toBe('latest');
    expect(planFor(trusted, 19).kind).toBe('latest');
    expect(planFor(createMessageStore({ messages: trusted.messages, lastRev: 20, revTrusted: true }), 25).kind).toBe('catch_up');
  });
});
