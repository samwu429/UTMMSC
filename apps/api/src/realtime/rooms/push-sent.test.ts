import { describe, expect, it } from 'vitest';
import { recordPushedMessage, takePushedMembers } from './push-sent';

/** Just enough of SqlStorage for the two statements push-sent runs. */
/** 只实现 push-sent 用到的两条语句的 SqlStorage。 */
function fakeSql(): { sql: SqlStorage; rows: Map<string, number> } {
  const rows = new Map<string, number>();
  const exec = (query: string, ...bindings: unknown[]) => {
    const statement = query.trim();
    if (statement.startsWith('INSERT')) {
      const [memberId, messageId] = bindings as [string, number];
      const current = rows.get(memberId);
      if (current === undefined || messageId > current) rows.set(memberId, messageId);
      return { toArray: () => [] };
    }
    if (statement.startsWith('DELETE')) {
      const [messageId] = bindings as [number];
      const taken = [...rows].filter(([, id]) => id === messageId).map(([memberId]) => memberId);
      for (const memberId of taken) rows.delete(memberId);
      return { toArray: () => taken.map((member_id) => ({ member_id })) };
    }
    throw new Error(`unexpected statement: ${statement}`);
  };
  return { sql: { exec } as unknown as SqlStorage, rows };
}

describe('pushed message marks', () => {
  it('finds the members still showing a message, once', () => {
    const { sql } = fakeSql();
    recordPushedMessage(sql, ['mem_bob', 'mem_carol'], 7);
    expect(takePushedMembers(sql, 7).sort()).toEqual(['mem_bob', 'mem_carol']);
    expect(takePushedMembers(sql, 7)).toEqual([]);
  });

  it('leaves out members whose notice a newer message already replaced', () => {
    const { sql, rows } = fakeSql();
    recordPushedMessage(sql, ['mem_bob', 'mem_carol'], 7);
    recordPushedMessage(sql, ['mem_bob'], 9);
    expect(takePushedMembers(sql, 7)).toEqual(['mem_carol']);
    expect(rows.get('mem_bob')).toBe(9);
  });

  it('never moves a member back to an older message', () => {
    const { sql, rows } = fakeSql();
    recordPushedMessage(sql, ['mem_bob'], 9);
    recordPushedMessage(sql, ['mem_bob'], 7);
    expect(rows.get('mem_bob')).toBe(9);
    expect(takePushedMembers(sql, 7)).toEqual([]);
  });
});
