import { describe, expect, it } from 'vitest';
import type { FriendSummary, MemberProfile } from '@utmmsc/shared';
import { afterAccept, afterRequest, friendshipOf, indexFriendships, keepUnchanged } from './friendships';

function card(id: string): FriendSummary['incoming'][number] {
  return { member: { id, displayName: id } as MemberProfile } as FriendSummary['incoming'][number];
}

const SUMMARY: FriendSummary = { incoming: [card('in')], outgoingIds: ['out'], friendIds: ['friend'] };

describe('friendshipOf', () => {
  it('tells each member apart from one index', () => {
    const index = indexFriendships(SUMMARY, 'me');
    expect(['me', 'friend', 'out', 'in', 'stranger'].map((id) => friendshipOf(index, id))).toEqual(['self', 'friends', 'outgoing', 'incoming', 'none']);
  });

  it('puts self and friends first, as the rows always did', () => {
    const index = indexFriendships({ incoming: [card('both')], outgoingIds: ['both'], friendIds: ['both'] }, 'both');
    expect(friendshipOf(index, 'both')).toBe('self');
    expect(friendshipOf(indexFriendships({ incoming: [card('x')], outgoingIds: ['x'], friendIds: ['x'] }, 'me'), 'x')).toBe('friends');
    expect(friendshipOf(indexFriendships({ incoming: [card('x')], outgoingIds: ['x'], friendIds: [] }, 'me'), 'x')).toBe('outgoing');
  });

  it('knows no one before the summary arrives', () => {
    const index = indexFriendships(null, undefined);
    expect(friendshipOf(index, 'anyone')).toBe('none');
  });
});

describe('keepUnchanged', () => {
  const member = (id: string, headline: string | null = null) => ({ id, displayName: id, headline }) as MemberProfile;

  it('keeps the old object for an unchanged member and takes new or changed ones', () => {
    const a = member('a');
    const b = member('b');
    const next = [member('b'), member('a', 'new title'), member('c')];
    const kept = keepUnchanged([a, b], next);
    expect(kept[0]).toBe(b);
    expect(kept[1]).toBe(next[1]);
    expect(kept[2]).toBe(next[2]);
    expect(kept.map((m) => m.id)).toEqual(['b', 'a', 'c']);
  });

  it('takes the new list as it is when nothing was shown before', () => {
    const next = [member('a')];
    expect(keepUnchanged([], next)).toEqual(next);
  });
});

describe('summary updates', () => {
  it('adds an outgoing request once', () => {
    const once = afterRequest(SUMMARY, 'new', 'outgoing');
    expect(once.outgoingIds).toEqual(['out', 'new']);
    expect(afterRequest(once, 'new', 'outgoing').outgoingIds).toEqual(['out', 'new']);
    expect(afterRequest(null, 'new', 'outgoing')).toEqual({ incoming: [], outgoingIds: ['new'], friendIds: [] });
  });

  it('makes friends at once when they had asked first', () => {
    expect(afterRequest(SUMMARY, 'in', 'friends')).toEqual({ incoming: [], outgoingIds: ['out'], friendIds: ['friend', 'in'] });
  });

  it('accepts a request', () => {
    expect(afterAccept(SUMMARY, 'in')).toEqual({ incoming: [], outgoingIds: ['out'], friendIds: ['friend', 'in'] });
    expect(afterAccept(afterAccept(SUMMARY, 'in'), 'in').friendIds).toEqual(['friend', 'in']);
  });
});
