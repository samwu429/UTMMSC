import { describe, expect, it } from 'vitest';
import { ROLES, type Role } from '../identity/roles';
import {
  canDeleteMomentComment,
  canInteractWithMoment,
  canModerateMoment,
  canReplyToMomentComment,
  canReportMoment,
  canSeeMomentInteraction,
  canSeeMomentPost,
  decideMomentModeration,
  isMomentClientId,
  momentTextLength,
  normalizeMomentComment,
  normalizeMomentText,
  showsOnHomeFeed,
  type MomentCommentFacts,
  type MomentPostFacts,
  type MomentViewer,
} from './rules';
import { MOMENT_AUDIENCES, type MomentAudience } from './types';

/**
 * author is friends with friend; stranger knows nobody; mutual is a friend of both author and friend, so the
 * friend sees mutual's interactions while the stranger does not.
 * author 与 friend 是好友；stranger 谁也不认识；mutual 同时是 author 和 friend 的好友，因此 friend 能看到 mutual 的互动，stranger 看不到。
 */
const author: MomentViewer = { id: 'author', friendIds: new Set(['friend', 'mutual']) };
const friend: MomentViewer = { id: 'friend', friendIds: new Set(['author', 'mutual']) };
const stranger: MomentViewer = { id: 'stranger', friendIds: new Set() };
const otherFriend: MomentViewer = { id: 'other', friendIds: new Set(['author']) };

function post(patch: Partial<MomentPostFacts> = {}): MomentPostFacts {
  return { authorId: 'author', authorActive: true, audience: 'friends', removed: false, hiddenFromViewer: false, ...patch };
}

describe('canSeeMomentPost', () => {
  const expected: Record<MomentAudience, { self: boolean; friend: boolean; stranger: boolean }> = {
    friends: { self: true, friend: true, stranger: false },
    club: { self: true, friend: true, stranger: true },
    private: { self: true, friend: false, stranger: false },
  };

  for (const audience of MOMENT_AUDIENCES) {
    it(`shows a live ${audience} post to the expected viewers`, () => {
      const facts = post({ audience });
      expect(canSeeMomentPost(author, facts)).toBe(expected[audience].self);
      expect(canSeeMomentPost(friend, facts)).toBe(expected[audience].friend);
      expect(canSeeMomentPost(stranger, facts)).toBe(expected[audience].stranger);
    });

    it(`hides a ${audience} post from anyone the author hid it from, but never from the author`, () => {
      const facts = post({ audience, hiddenFromViewer: true });
      expect(canSeeMomentPost(author, facts)).toBe(true);
      expect(canSeeMomentPost(friend, facts)).toBe(false);
      expect(canSeeMomentPost(stranger, facts)).toBe(false);
    });

    it(`keeps a removed ${audience} post for its author only`, () => {
      const facts = post({ audience, removed: true });
      expect(canSeeMomentPost(author, facts)).toBe(true);
      expect(canSeeMomentPost(friend, facts)).toBe(false);
      expect(canSeeMomentPost(stranger, facts)).toBe(false);
    });

    it(`hides every ${audience} post of an inactive author, from the author too`, () => {
      const facts = post({ audience, authorActive: false });
      expect(canSeeMomentPost(author, facts)).toBe(false);
      expect(canSeeMomentPost(friend, facts)).toBe(false);
      expect(canSeeMomentPost(stranger, facts)).toBe(false);
    });
  }
});

describe('showsOnHomeFeed', () => {
  it('skips a muted author on the home feed while the album still shows the post', () => {
    const facts = post({ audience: 'club' });
    expect(showsOnHomeFeed(friend, facts, true)).toBe(false);
    expect(canSeeMomentPost(friend, facts)).toBe(true);
    expect(showsOnHomeFeed(friend, facts, false)).toBe(true);
  });

  it('never skips posts by the viewer', () => {
    expect(showsOnHomeFeed(author, post({ audience: 'private' }), true)).toBe(true);
  });

  it('adds nothing a viewer could not see anyway', () => {
    expect(showsOnHomeFeed(stranger, post({ audience: 'friends' }), false)).toBe(false);
    expect(showsOnHomeFeed(friend, post({ audience: 'club', hiddenFromViewer: true }), false)).toBe(false);
  });
});

describe('canSeeMomentInteraction', () => {
  const club = post({ audience: 'club' });
  const friends = post({ audience: 'friends' });

  it('shows every interaction on a club post to everyone', () => {
    for (const viewer of [author, friend, stranger, otherFriend]) {
      expect(canSeeMomentInteraction(viewer, club, 'stranger', null)).toBe(true);
      expect(canSeeMomentInteraction(viewer, club, 'mutual', 'other')).toBe(true);
    }
  });

  it('shows the author every interaction on their friends post', () => {
    expect(canSeeMomentInteraction(author, friends, 'other', null)).toBe(true);
    expect(canSeeMomentInteraction(author, friends, 'friend', 'other')).toBe(true);
  });

  it('shows a friend the interactions of themselves, the author and their own friends only', () => {
    expect(canSeeMomentInteraction(friend, friends, 'friend', null)).toBe(true);
    expect(canSeeMomentInteraction(friend, friends, 'author', null)).toBe(true);
    expect(canSeeMomentInteraction(friend, friends, 'mutual', null)).toBe(true);
    expect(canSeeMomentInteraction(friend, friends, 'other', null)).toBe(false);
  });

  it('gives a stranger only their own interactions and those of the author', () => {
    expect(canSeeMomentInteraction(stranger, friends, 'stranger', null)).toBe(true);
    expect(canSeeMomentInteraction(stranger, friends, 'author', null)).toBe(true);
    expect(canSeeMomentInteraction(stranger, friends, 'mutual', null)).toBe(false);
  });

  it('hides a reply whose target the viewer cannot see, even when the replier is visible', () => {
    expect(canSeeMomentInteraction(friend, friends, 'mutual', 'other')).toBe(false);
    expect(canSeeMomentInteraction(friend, friends, 'author', 'other')).toBe(false);
    expect(canSeeMomentInteraction(otherFriend, friends, 'author', 'friend')).toBe(false);
    expect(canSeeMomentInteraction(friend, friends, 'author', 'mutual')).toBe(true);
    expect(canSeeMomentInteraction(otherFriend, friends, 'other', 'author')).toBe(true);
  });

  it('applies the friends rule to private posts as well', () => {
    const own = post({ audience: 'private' });
    expect(canSeeMomentInteraction(author, own, 'author', null)).toBe(true);
    expect(canSeeMomentInteraction(friend, own, 'other', null)).toBe(false);
  });
});

describe('permission predicates', () => {
  const comment = (patch: Partial<MomentCommentFacts> = {}): MomentCommentFacts => ({
    postId: 'p1',
    authorId: 'mutual',
    authorActive: true,
    replyToId: null,
    removed: false,
    ...patch,
  });

  it('allows likes and comments only on visible posts a moderator has not removed', () => {
    expect(canInteractWithMoment(friend, post())).toBe(true);
    expect(canInteractWithMoment(stranger, post())).toBe(false);
    expect(canInteractWithMoment(author, post({ removed: true }))).toBe(false);
  });

  it('allows a reply only to a live, visible comment on the same post by someone else', () => {
    expect(canReplyToMomentComment(friend, 'p1', post(), comment())).toBe(true);
    expect(canReplyToMomentComment(friend, 'p2', post(), comment())).toBe(false);
    expect(canReplyToMomentComment(friend, 'p1', post(), comment({ removed: true }))).toBe(false);
    expect(canReplyToMomentComment(friend, 'p1', post(), comment({ authorActive: false }))).toBe(false);
    expect(canReplyToMomentComment(friend, 'p1', post(), comment({ authorId: 'friend' }))).toBe(false);
    expect(canReplyToMomentComment(friend, 'p1', post(), comment({ authorId: 'other' }))).toBe(false);
    expect(canReplyToMomentComment(friend, 'p1', post(), comment({ replyToId: 'other' }))).toBe(false);
    expect(canReplyToMomentComment(friend, 'p1', post({ removed: true }), comment())).toBe(false);
    expect(canReplyToMomentComment(stranger, 'p1', post({ audience: 'club' }), comment({ authorId: 'other' }))).toBe(true);
  });

  it('lets the comment author and the post author delete a comment', () => {
    expect(canDeleteMomentComment('mutual', { authorId: 'mutual' }, { authorId: 'author' })).toBe(true);
    expect(canDeleteMomentComment('author', { authorId: 'mutual' }, { authorId: 'author' })).toBe(true);
    expect(canDeleteMomentComment('friend', { authorId: 'mutual' }, { authorId: 'author' })).toBe(false);
  });

  it('lets a moderator act only on other people who sit below them', () => {
    expect(canModerateMoment({ id: 'p', role: 'president' }, { id: 's', role: 'student' })).toBe(true);
    expect(canModerateMoment({ id: 'p', role: 'president' }, { id: 'p', role: 'president' })).toBe(false);
    expect(canModerateMoment({ id: 'a', role: 'superadmin' }, { id: 'a', role: 'superadmin' })).toBe(false);
    expect(canModerateMoment({ id: 'p', role: 'president' }, { id: 'v', role: 'vp_finance' })).toBe(false);
    expect(canModerateMoment({ id: 's', role: 'student' }, { id: 't', role: 'student' })).toBe(false);
  });

  it('lets anyone who can see content report it, except its author', () => {
    expect(canReportMoment('friend', 'author', true)).toBe(true);
    expect(canReportMoment('author', 'author', true)).toBe(false);
    expect(canReportMoment('stranger', 'author', false)).toBe(false);
  });
});

describe('decideMomentModeration', () => {
  it('refuses members and department heads, who lack chat.moderate', () => {
    expect(decideMomentModeration('student', 'student')).toBe('no_permission');
    expect(decideMomentModeration('alumni', null)).toBe('no_permission');
    expect(decideMomentModeration('head_events', 'student')).toBe('no_permission');
  });

  it('refuses presidium officers without chat.moderate, even over their peers', () => {
    expect(decideMomentModeration('secretary_general', 'student')).toBe('no_permission');
    expect(decideMomentModeration('vp_finance', 'vp_audit')).toBe('no_permission');
  });

  it('lets the president act on members and heads but not on presidium peers', () => {
    expect(decideMomentModeration('president', 'student')).toBe('ok');
    expect(decideMomentModeration('president', 'head_technology')).toBe('ok');
    expect(decideMomentModeration('president', 'vp_finance')).toBe('outranked');
    expect(decideMomentModeration('president', 'vp_audit')).toBe('outranked');
    expect(decideMomentModeration('president', 'president')).toBe('outranked');
    expect(decideMomentModeration('president', 'superadmin')).toBe('outranked');
  });

  it('lets the system admin act on anyone', () => {
    for (const role of ROLES) expect(decideMomentModeration('superadmin', role)).toBe('ok');
  });

  it('allows a target whose account is gone, for moderators only', () => {
    expect(decideMomentModeration('president', null)).toBe('ok');
    expect(decideMomentModeration('superadmin', null)).toBe('ok');
  });

  it('never answers direct, which only applies to chat', () => {
    for (const actor of ROLES) {
      for (const target of [...ROLES, null] as (Role | null)[]) {
        expect(['ok', 'no_permission', 'outranked']).toContain(decideMomentModeration(actor, target));
      }
    }
  });
});

describe('isMomentClientId', () => {
  it('accepts 8 to 64 url-safe characters', () => {
    expect(isMomentClientId('abcdEFGH')).toBe(true);
    expect(isMomentClientId('a1_-'.repeat(16))).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isMomentClientId('short')).toBe(false);
    expect(isMomentClientId('a'.repeat(65))).toBe(false);
    expect(isMomentClientId('abc def gh')).toBe(false);
    expect(isMomentClientId('abcdefgh/')).toBe(false);
    expect(isMomentClientId('评论评论评论评论')).toBe(false);
    expect(isMomentClientId(12345678)).toBe(false);
    expect(isMomentClientId(null)).toBe(false);
  });
});

describe('momentTextLength', () => {
  it('counts code points, so emoji and rare characters count once', () => {
    expect(momentTextLength('')).toBe(0);
    expect(momentTextLength('好友动态')).toBe(4);
    expect(momentTextLength('\u{1F600}\u{1F600}')).toBe(2);
    expect('\u{1F600}\u{1F600}'.length).toBe(4);
    expect(momentTextLength('𠀀a')).toBe(2);
  });
});

describe('normalizeMomentText', () => {
  it('trims the ends and turns every line break into \\n', () => {
    expect(normalizeMomentText('  hi\r\nthere\rnow  ')).toBe('hi\nthere\nnow');
    expect(normalizeMomentText(`a${String.fromCharCode(0x2028)}b`)).toBe('a\nb');
  });

  it('drops control characters but keeps newlines, and turns tabs into spaces', () => {
    expect(normalizeMomentText('a\u0000b\u0007c\u007f\u0085d\ne')).toBe('abcd\ne');
    expect(normalizeMomentText('a\tb')).toBe('a b');
  });

  it('keeps two blank lines at most', () => {
    expect(normalizeMomentText('a\n\nb')).toBe('a\n\nb');
    expect(normalizeMomentText('a\n\n\nb')).toBe('a\n\n\nb');
    expect(normalizeMomentText('a\n\n\n\n\n\nb')).toBe('a\n\n\nb');
    expect(normalizeMomentText('a\n  \n \n\t\n\nb')).toBe('a\n\n\nb');
  });

  it('keeps leading spaces inside the text and joined emoji', () => {
    expect(normalizeMomentText('list:\n  - one')).toBe('list:\n  - one');
    const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}';
    expect(normalizeMomentText(family)).toBe(family);
  });

  it('leaves nothing but whitespace as empty', () => {
    expect(normalizeMomentText(' \n\r\n\t ')).toBe('');
  });
});

describe('normalizeMomentComment', () => {
  it('makes one line with single spaces', () => {
    expect(normalizeMomentComment('  好的\n明天\r\n见  ')).toBe('好的 明天 见');
    expect(normalizeMomentComment('a   b\t\tc')).toBe('a b c');
    expect(normalizeMomentComment(`a${String.fromCharCode(0x2029)}b`)).toBe('a b');
  });

  it('drops control characters', () => {
    expect(normalizeMomentComment('a\u0000b\u001bc')).toBe('abc');
  });

  it('leaves nothing but whitespace as empty', () => {
    expect(normalizeMomentComment('\n \t ')).toBe('');
  });
});
