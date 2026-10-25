import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MemberSelf } from '@utmmsc/shared';
import { sameJson, useSessionStore } from './store';

function member(extra: Partial<MemberSelf> = {}): MemberSelf {
  return { id: 'mem_me', displayName: '测试', role: 'student', skills: ['a', 'b'], avatarKey: null, ...extra } as MemberSelf;
}

afterEach(() => {
  useSessionStore.setState({ token: null, member: null, mediaToken: null });
});

describe('sameJson', () => {
  it('compares JSON data by value, ignoring key order', () => {
    expect(sameJson({ a: 1, b: [1, { c: null }] }, { b: [1, { c: null }], a: 1 })).toBe(true);
    expect(sameJson({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(sameJson({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
    expect(sameJson([], {})).toBe(false);
    expect(sameJson(null, {})).toBe(false);
    expect(sameJson('x', 'x')).toBe(true);
    expect(sameJson(Number.NaN, Number.NaN)).toBe(true);
  });
});

describe('useSessionStore', () => {
  it('keeps the member object when a refresh brings the same data', () => {
    useSessionStore.getState().setSession('tok', member(), 'media');
    const before = useSessionStore.getState().member;
    const listener = vi.fn();
    const unsubscribe = useSessionStore.subscribe(listener);
    useSessionStore.getState().setMember(member());
    useSessionStore.getState().setMediaToken('media');
    expect(listener).not.toHaveBeenCalled();
    expect(useSessionStore.getState().member).toBe(before);
    unsubscribe();
  });

  it('takes a member whose data changed', () => {
    useSessionStore.getState().setSession('tok', member(), 'media');
    useSessionStore.getState().setMember(member({ skills: ['a', 'c'] }));
    expect(useSessionStore.getState().member?.skills).toEqual(['a', 'c']);
    useSessionStore.getState().setMediaToken('next');
    expect(useSessionStore.getState().mediaToken).toBe('next');
  });
});
