import { describe, expect, it } from 'vitest';
import { compoundTerms, createSqliteD1, D1_LIMITS, sqlite } from './sqlite-d1';

const select = (n: number) => Array.from({ length: n }, (_, i) => `SELECT ${i} AS x`).join(' UNION ALL ');

describe('compoundTerms', () => {
  it('counts the terms of the widest compound SELECT, per parenthesis level', () => {
    expect(compoundTerms('SELECT 1')).toBe(1);
    expect(compoundTerms(select(5))).toBe(5);
    expect(compoundTerms('SELECT 1 UNION SELECT 2 INTERSECT SELECT 3 EXCEPT SELECT 4')).toBe(4);
    // A compound inside a subquery is a compound of its own.
    // 子查询中的复合查询是独立的一个。
    expect(compoundTerms(`SELECT * FROM (${select(3)}) UNION ALL SELECT * FROM (${select(4)})`)).toBe(4);
    expect(compoundTerms(`SELECT COUNT(*) FROM t WHERE id IN (${select(6)})`)).toBe(6);
  });

  it('ignores the keywords inside strings, quoted names and comments', () => {
    expect(compoundTerms(`SELECT 'a UNION b UNION c UNION d UNION e UNION f' -- UNION UNION\n/* UNION */ AS "UNION"`)).toBe(1);
  });
});

describe.skipIf(!sqlite)('D1 limits', () => {
  it('refuses what D1 refuses: six compound terms, 101 bound values and statements over 100 KB', async () => {
    const d1 = createSqliteD1({ migrate: false });
    await expect(d1.db.prepare(select(5)).all()).resolves.toMatchObject({ success: true });
    await expect(d1.db.prepare(select(6)).all()).rejects.toThrow(/too many terms in compound SELECT/);
    const marks = (n: number) => Array.from({ length: n }, () => '?').join(', ');
    await expect(d1.db.prepare(`SELECT ${marks(D1_LIMITS.boundParameters)}`).bind(...Array.from({ length: 100 }, (_, i) => i)).all()).resolves.toBeTruthy();
    await expect(d1.db.prepare(`SELECT ${marks(101)}`).bind(...Array.from({ length: 101 }, (_, i) => i)).all()).rejects.toThrow(/too many SQL variables/);
    await expect(d1.db.prepare(`SELECT '${'x'.repeat(D1_LIMITS.statementBytes)}'`).all()).rejects.toThrow(/too long/);
    d1.close();
  });
});
