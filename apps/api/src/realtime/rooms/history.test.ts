import { describe, expect, it } from 'vitest';
import { MENTIONS_MAX, QUOTE_EXCERPT_MAX } from '@utmmsc/shared';
import {
  JOIN_MEMBERS_MAX,
  buildQuotePreview,
  capList,
  decideFloor,
  joinEvent,
  joinFallbackText,
  quoteForViewer,
  sanitizeMentions,
  slicePage,
  unreadBaseline,
  type QuoteTarget,
} from './history';

describe('decideFloor', () => {
  it('has no floor for grandfathered members who never cleared', () => {
    expect(decideFloor({ floorApplies: false, joinFirstId: null, clearId: 0 })).toEqual({ floorId: 0, floorReason: null });
    expect(decideFloor({ floorApplies: false, joinFirstId: 40, clearId: 0 })).toEqual({ floorId: 0, floorReason: null });
  });

  it('floors at the first message after the join', () => {
    expect(decideFloor({ floorApplies: true, joinFirstId: 81, clearId: 0 })).toEqual({ floorId: 81, floorReason: 'join' });
  });

  it('uses the clear point when it is higher than the join floor', () => {
    expect(decideFloor({ floorApplies: true, joinFirstId: 81, clearId: 120 })).toEqual({ floorId: 121, floorReason: 'clear' });
    expect(decideFloor({ floorApplies: false, joinFirstId: null, clearId: 9 })).toEqual({ floorId: 10, floorReason: 'clear' });
  });

  it('keeps the join floor when the clear point is below it', () => {
    expect(decideFloor({ floorApplies: true, joinFirstId: 81, clearId: 30 })).toEqual({ floorId: 81, floorReason: 'join' });
  });
});

describe('unreadBaseline', () => {
  it('starts a new member at their join, not at message one', () => {
    expect(unreadBaseline({ cursor: 0, joinFirstId: 81, clearId: 0 })).toBe(80);
  });

  it('never moves below the read cursor or the clear point', () => {
    expect(unreadBaseline({ cursor: 95, joinFirstId: 81, clearId: 0 })).toBe(95);
    expect(unreadBaseline({ cursor: 10, joinFirstId: null, clearId: 50 })).toBe(50);
    expect(unreadBaseline({ cursor: 0, joinFirstId: null, clearId: 0 })).toBe(0);
  });
});

describe('slicePage', () => {
  const desc = [{ id: 5 }, { id: 4 }, { id: 3 }];

  it('returns latest and older pages ascending and reports more', () => {
    expect(slicePage(desc, 2, 'latest')).toEqual({ page: [{ id: 4 }, { id: 5 }], hasMore: true, hasNewer: false });
    expect(slicePage(desc, 3, 'older')).toEqual({ page: [{ id: 3 }, { id: 4 }, { id: 5 }], hasMore: false, hasNewer: false });
  });

  it('keeps newer pages ascending and reports hasNewer', () => {
    const asc = [{ id: 6 }, { id: 7 }, { id: 8 }];
    expect(slicePage(asc, 2, 'newer')).toEqual({ page: [{ id: 6 }, { id: 7 }], hasMore: false, hasNewer: true });
    expect(slicePage(asc, 5, 'newer').hasNewer).toBe(false);
  });
});

const target: QuoteTarget = {
  id: 10,
  kind: 'user',
  author_id: 'mem_a',
  author_name: 'A',
  text: 'quoted   words',
  image_key: null,
  deleted: 0,
  recalled: 0,
};

describe('buildQuotePreview', () => {
  it('builds a live excerpt', () => {
    expect(buildQuotePreview(10, target, 0)).toEqual({ id: 10, authorId: 'mem_a', authorName: 'A', excerpt: 'quoted words', hasImage: false, state: 'ok' });
    const long = buildQuotePreview(10, { ...target, text: 'x'.repeat(200), image_key: 'k' }, 0);
    expect(long.excerpt).toHaveLength(QUOTE_EXCERPT_MAX);
    expect(long.hasImage).toBe(true);
  });

  it('drops the body of recalled and deleted targets', () => {
    expect(buildQuotePreview(10, { ...target, recalled: 1 }, 0)).toMatchObject({ state: 'recalled', excerpt: '', hasImage: false });
    expect(buildQuotePreview(10, { ...target, deleted: 1, image_key: 'k' }, 0)).toMatchObject({ state: 'deleted', excerpt: '', hasImage: false });
  });

  it('reveals nothing for missing, system, or below-floor targets', () => {
    const hidden = { id: 10, authorId: '', authorName: '', excerpt: '', hasImage: false, state: 'unavailable' };
    expect(buildQuotePreview(10, undefined, 0)).toEqual(hidden);
    expect(buildQuotePreview(10, { ...target, kind: 'system' }, 0)).toEqual(hidden);
    expect(buildQuotePreview(10, target, 11)).toEqual(hidden);
    expect(buildQuotePreview(10, target, 10).state).toBe('ok');
  });
});

describe('quoteForViewer', () => {
  it('narrows a quote below the socket floor', () => {
    const quote = buildQuotePreview(10, target, 0);
    expect(quoteForViewer(quote, 0)).toBe(quote);
    expect(quoteForViewer(quote, 11)).toMatchObject({ id: 10, state: 'unavailable', excerpt: '', authorName: '' });
    expect(quoteForViewer(null, 5)).toBeNull();
  });
});

describe('sanitizeMentions', () => {
  it('dedupes, drops the sender and caps', () => {
    expect(sanitizeMentions(['a', 'b', 'a', 'me', 'system'], 'me', 'channel')).toEqual(['a', 'b']);
    const many = Array.from({ length: MENTIONS_MAX + 5 }, (_, i) => 'mem_' + String(i));
    expect(sanitizeMentions(many, 'me', 'channel')).toHaveLength(MENTIONS_MAX);
  });

  it('ignores mentions in direct conversations', () => {
    expect(sanitizeMentions(['a'], 'me', 'direct')).toEqual([]);
    expect(sanitizeMentions(undefined, 'me', 'channel')).toEqual([]);
  });
});

describe('capList', () => {
  it('reports overflow only past the cap', () => {
    expect(capList([1, 2, 3], 3)).toEqual({ items: [1, 2, 3], overflow: false });
    expect(capList([1, 2, 3, 4], 3)).toEqual({ items: [1, 2, 3], overflow: true });
  });
});

describe('join notices', () => {
  const actor = { id: 'mem_admin', displayName: '管理员' };
  const people = (n: number) => Array.from({ length: n }, (_, i) => ({ id: 'mem_' + String(i), displayName: 'P' + String(i) }));

  it('keeps at most twenty names and counts the rest', () => {
    const event = joinEvent(actor, people(JOIN_MEMBERS_MAX + 3));
    expect(event.members).toHaveLength(JOIN_MEMBERS_MAX);
    expect(event.more).toBe(3);
  });

  it('writes a readable Chinese fallback', () => {
    expect(joinFallbackText(joinEvent(actor, people(1)))).toBe('“管理员”邀请“P0”加入了频道');
    expect(joinFallbackText(joinEvent(actor, people(2)))).toBe('“管理员”邀请“P0”、“P1”加入了频道');
    expect(joinFallbackText(joinEvent(actor, people(5)))).toBe('“管理员”邀请“P0”、“P1”、“P2”等5人加入了频道');
    expect(joinFallbackText(joinEvent(null, people(1)))).toBe('“P0”加入了频道');
  });
});
