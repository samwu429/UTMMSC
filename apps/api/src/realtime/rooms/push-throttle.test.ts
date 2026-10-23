import { describe, expect, it } from 'vitest';
import { claimPushSlots, selectUnthrottled, type PushMark } from './push-throttle';

const INTERVAL = 5_000;
const T0 = 1_800_000_000_000;

const plain = (memberId: string) => ({ memberId, mentioned: false });
const named = (memberId: string) => ({ memberId, mentioned: true });

describe('selectUnthrottled', () => {
  it('lets through members this room has not pushed recently', () => {
    const marks = new Map<string, PushMark>([['mem_old', { lastPushAt: T0 - INTERVAL, lastMentionAt: null }]]);
    expect(selectUnthrottled([plain('mem_new'), plain('mem_old')], marks, T0, INTERVAL).map((r) => r.memberId)).toEqual(['mem_new', 'mem_old']);
  });

  it('holds back a second ordinary push inside the interval', () => {
    const marks = new Map<string, PushMark>([['mem_bob', { lastPushAt: T0 - 1_000, lastMentionAt: null }]]);
    expect(selectUnthrottled([plain('mem_bob')], marks, T0, INTERVAL)).toEqual([]);
    expect(selectUnthrottled([plain('mem_bob')], marks, T0 + 3_999, INTERVAL)).toEqual([]);
    expect(selectUnthrottled([plain('mem_bob')], marks, T0 + 4_000, INTERVAL)).toEqual([plain('mem_bob')]);
  });

  it('lets a mention follow an ordinary push, but only one mention per interval', () => {
    const afterPlain = new Map<string, PushMark>([['mem_bob', { lastPushAt: T0 - 1_000, lastMentionAt: null }]]);
    expect(selectUnthrottled([named('mem_bob')], afterPlain, T0, INTERVAL)).toEqual([named('mem_bob')]);

    const afterMention = new Map<string, PushMark>([['mem_bob', { lastPushAt: T0 - 1_000, lastMentionAt: T0 - 1_000 }]]);
    expect(selectUnthrottled([named('mem_bob')], afterMention, T0, INTERVAL)).toEqual([]);
    expect(selectUnthrottled([plain('mem_bob')], afterMention, T0, INTERVAL)).toEqual([]);
  });

  it('ignores marks from a clock that has since moved back', () => {
    const marks = new Map<string, PushMark>([['mem_bob', { lastPushAt: T0 + 60_000, lastMentionAt: T0 + 60_000 }]]);
    expect(selectUnthrottled([plain('mem_bob')], marks, T0, INTERVAL)).toEqual([plain('mem_bob')]);
  });
});

interface Row {
  member_id: string;
  last_push_at: number;
  last_mention_at: number | null;
}

/** Just enough of SqlStorage for the three statements claimPushSlots runs. */
/** 只实现 claimPushSlots 用到的三条语句的 SqlStorage。 */
function fakeSql(): { sql: SqlStorage; rows: Map<string, Row> } {
  const rows = new Map<string, Row>();
  const exec = (query: string, ...bindings: unknown[]): Row[] => {
    const statement = query.trim();
    if (statement.startsWith('DELETE')) {
      const [staleAt, now] = bindings as [number, number];
      for (const [id, row] of rows) if (row.last_push_at <= staleAt || row.last_push_at > now) rows.delete(id);
      return [];
    }
    if (statement.startsWith('SELECT')) return [...rows.values()];
    if (statement.startsWith('INSERT')) {
      const [memberId, at, mentionAt] = bindings as [string, number, number | null];
      rows.set(memberId, { member_id: memberId, last_push_at: at, last_mention_at: mentionAt ?? rows.get(memberId)?.last_mention_at ?? null });
      return [];
    }
    throw new Error(`unexpected statement: ${statement}`);
  };
  return { sql: { exec } as unknown as SqlStorage, rows };
}

describe('claimPushSlots', () => {
  it('records each allowed push and holds the next one back', () => {
    const { sql, rows } = fakeSql();
    expect(claimPushSlots(sql, [plain('mem_bob'), plain('mem_carol')], T0, INTERVAL)).toEqual(['mem_bob', 'mem_carol']);
    expect(rows.get('mem_bob')).toEqual({ member_id: 'mem_bob', last_push_at: T0, last_mention_at: null });

    expect(claimPushSlots(sql, [plain('mem_bob'), plain('mem_dave')], T0 + 2_000, INTERVAL)).toEqual(['mem_dave']);
    expect(rows.get('mem_bob')?.last_push_at).toBe(T0);
  });

  it('lets one mention through inside the interval and keeps its time', () => {
    const { sql, rows } = fakeSql();
    claimPushSlots(sql, [plain('mem_bob')], T0, INTERVAL);
    expect(claimPushSlots(sql, [named('mem_bob')], T0 + 1_000, INTERVAL)).toEqual(['mem_bob']);
    expect(rows.get('mem_bob')).toEqual({ member_id: 'mem_bob', last_push_at: T0 + 1_000, last_mention_at: T0 + 1_000 });
    expect(claimPushSlots(sql, [named('mem_bob')], T0 + 2_000, INTERVAL)).toEqual([]);
    expect(claimPushSlots(sql, [plain('mem_bob')], T0 + 3_000, INTERVAL)).toEqual([]);
  });

  it('pushes again once the interval has passed and drops stale rows', () => {
    const { sql, rows } = fakeSql();
    claimPushSlots(sql, [plain('mem_bob'), plain('mem_carol')], T0, INTERVAL);
    expect(claimPushSlots(sql, [plain('mem_bob')], T0 + INTERVAL, INTERVAL)).toEqual(['mem_bob']);
    expect([...rows.keys()]).toEqual(['mem_bob']);
  });

  it('only cleans up when nobody is left to push', () => {
    const { sql, rows } = fakeSql();
    claimPushSlots(sql, [plain('mem_bob')], T0, INTERVAL);
    expect(claimPushSlots(sql, [], T0 + INTERVAL, INTERVAL)).toEqual([]);
    expect(rows.size).toBe(0);
  });
});
