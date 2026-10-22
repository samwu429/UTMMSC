import { describe, expect, it } from 'vitest';
import { isMissingSchemaError, planMembershipReplace } from './channels';

describe('planMembershipReplace', () => {
  it('retains members who stay, so their join time is not rewritten', () => {
    expect(planMembershipReplace(['a', 'b'], ['b', 'a'])).toEqual({ add: [], remove: [] });
  });

  it('adds only new members', () => {
    expect(planMembershipReplace(['a'], ['a', 'b', 'c'])).toEqual({ add: ['b', 'c'], remove: [] });
  });

  it('removes only members who left', () => {
    expect(planMembershipReplace(['a', 'b', 'c'], ['b'])).toEqual({ add: [], remove: ['a', 'c'] });
  });

  it('handles empty lists on either side', () => {
    expect(planMembershipReplace([], ['a'])).toEqual({ add: ['a'], remove: [] });
    expect(planMembershipReplace(['a'], [])).toEqual({ add: [], remove: ['a'] });
    expect(planMembershipReplace([], [])).toEqual({ add: [], remove: [] });
  });

  it('counts duplicates once', () => {
    expect(planMembershipReplace(['a', 'a'], ['b', 'b', 'a'])).toEqual({ add: ['b'], remove: [] });
  });

  it('treats a removed and re-added member as a fresh add', () => {
    const removed = planMembershipReplace(['a', 'b'], ['a']);
    expect(removed.remove).toEqual(['b']);
    expect(planMembershipReplace(['a'], ['a', 'b']).add).toEqual(['b']);
  });
});

describe('isMissingSchemaError', () => {
  it('recognizes errors from a database without the latest migration', () => {
    expect(isMissingSchemaError(new Error('D1_ERROR: no such table: chat_prefs: SQLITE_ERROR'))).toBe(true);
    expect(isMissingSchemaError(new Error('D1_ERROR: no such column: history_visibility'))).toBe(true);
    expect(isMissingSchemaError(new Error('table channels has no column named history_visibility'))).toBe(true);
    expect(isMissingSchemaError(new Error('UNIQUE constraint failed'))).toBe(false);
  });
});
