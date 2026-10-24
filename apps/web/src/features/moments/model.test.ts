import { describe, expect, it } from 'vitest';
import { isMomentClientId } from '@utmmsc/shared';
import {
  albumFeedKey,
  commentViewKey,
  emptyFeedList,
  HOME_FEED,
  initialFeedState,
  isLocalPostKey,
  localPostKey,
  mediaCellValue,
  momentViewKey,
  newMomentClientId,
  parseFeedKey,
  postFeedKey,
} from './model';

describe('feed keys', () => {
  it('round-trips every kind of list', () => {
    expect(parseFeedKey(HOME_FEED)).toEqual({ kind: 'home' });
    expect(parseFeedKey(albumFeedKey('mem_1'))).toEqual({ kind: 'album', memberId: 'mem_1' });
    expect(parseFeedKey(postFeedKey('post_a:b'))).toEqual({ kind: 'post', postId: 'post_a:b' });
  });

  it('starts a list empty and idle, with its own objects', () => {
    const a = emptyFeedList(HOME_FEED);
    const b = emptyFeedList(HOME_FEED);
    expect(a).toMatchObject({ key: 'home', ids: [], status: 'idle', nextCursor: null, scrollY: null, owner: null });
    expect(a.ids).not.toBe(b.ids);
    expect(a.expanded).not.toBe(b.expanded);
  });

  it('starts the store online with nothing in it', () => {
    const state = initialFeedState();
    expect(state.online).toBe(true);
    expect(state.me).toBeNull();
    expect(Object.keys(state.lists)).toEqual([]);
    expect(initialFeedState().posts).not.toBe(state.posts);
  });
});

describe('view keys', () => {
  it('keeps the local key of an own post across the swap to the server post', () => {
    expect(momentViewKey({ id: localPostKey('abcdefgh12'), clientId: 'abcdefgh12' })).toBe('local:abcdefgh12');
    expect(momentViewKey({ id: 'post_1', clientId: 'abcdefgh12' })).toBe('local:abcdefgh12');
    expect(momentViewKey({ id: 'post_2' })).toBe('post_2');
    expect(isLocalPostKey(localPostKey('abcdefgh12'))).toBe(true);
    expect(isLocalPostKey('post_1')).toBe(false);
  });

  it('keys an own comment by its client id, pending or confirmed, and others by id', () => {
    expect(commentViewKey({ clientId: 'c1c1c1c1c1' })).toBe('local:c1c1c1c1c1');
    expect(commentViewKey({ id: 'cmt_1', clientId: 'c1c1c1c1c1' })).toBe('local:c1c1c1c1c1');
    expect(commentViewKey({ id: 'cmt_2' })).toBe('cmt_2');
  });

  it('names media cells by post and index', () => {
    expect(mediaCellValue('post_1', 3)).toBe('post_1:3');
  });
});

describe('newMomentClientId', () => {
  it('makes ids the server accepts, different every time', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newMomentClientId()));
    expect(ids.size).toBe(50);
    for (const id of ids) {
      expect(id).toHaveLength(22);
      expect(isMomentClientId(id)).toBe(true);
    }
  });
});
