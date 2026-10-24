import { describe, expect, it } from 'vitest';
import { MOMENT_THREAD_RECIPIENTS_MAX } from '@utmmsc/shared';
import { planCommentNotices, planLikeNotice, type CommentEvent, type Participant } from './notices';

function person(memberId: string, patch: Partial<Participant> = {}): Participant {
  return {
    memberId,
    lastAt: '2026-10-24T08:00:00.000Z',
    friendOfActor: false,
    friendOfReplyTo: false,
    friendOfAuthor: false,
    hiddenFrom: false,
    ...patch,
  };
}

function event(patch: Partial<CommentEvent> = {}): CommentEvent {
  return { postAuthorId: 'author', audience: 'friends', actorId: 'actor', replyToMemberId: null, replyTarget: null, participants: [], ...patch };
}

describe('planCommentNotices', () => {
  it('tells nobody about the author commenting on or answering themselves', () => {
    expect(planCommentNotices(event({ actorId: 'author' }))).toEqual([]);
    expect(planCommentNotices(event({ actorId: 'author', replyToMemberId: 'author', replyTarget: person('author') }))).toEqual([]);
  });

  it('tells the author about a plain comment', () => {
    expect(planCommentNotices(event())).toEqual([{ recipientId: 'author', kind: 'comment' }]);
  });

  it('sends one reply, and no comment notice, when the author is the one answered', () => {
    const plan = planCommentNotices(event({ replyToMemberId: 'author', replyTarget: person('author', { friendOfActor: true }) }));
    expect(plan).toEqual([{ recipientId: 'author', kind: 'reply' }]);
  });

  it('sends the author a comment and a third party a reply', () => {
    const target = person('third', { friendOfActor: true, friendOfAuthor: true });
    const plan = planCommentNotices(event({ replyToMemberId: 'third', replyTarget: target, participants: [target] }));
    expect(plan).toEqual([
      { recipientId: 'third', kind: 'reply' },
      { recipientId: 'author', kind: 'comment' },
    ]);
  });

  it('skips the reply when the member answered can no longer see the post', () => {
    const hidden = person('third', { friendOfActor: true, friendOfAuthor: true, hiddenFrom: true });
    expect(planCommentNotices(event({ replyToMemberId: 'third', replyTarget: hidden }))).toEqual([{ recipientId: 'author', kind: 'comment' }]);
    const notFriend = person('third', { friendOfActor: true });
    expect(planCommentNotices(event({ replyToMemberId: 'third', replyTarget: notFriend, participants: [notFriend] }))).toEqual([
      { recipientId: 'author', kind: 'comment' },
    ]);
    expect(planCommentNotices(event({ audience: 'club', replyToMemberId: 'third', replyTarget: notFriend }))).toEqual([
      { recipientId: 'third', kind: 'reply' },
      { recipientId: 'author', kind: 'comment' },
    ]);
    expect(planCommentNotices(event({ replyToMemberId: 'third', replyTarget: null }))).toEqual([{ recipientId: 'author', kind: 'comment' }]);
  });

  it('never tells the actor, even when they appear as a participant', () => {
    const plan = planCommentNotices(event({ audience: 'club', participants: [person('actor'), person('other')] }));
    expect(plan.map((notice) => notice.recipientId)).toEqual(['author', 'other']);
  });

  it('tells everyone on a club post who is not hidden from it', () => {
    const plan = planCommentNotices(
      event({
        audience: 'club',
        participants: [person('stranger'), person('hidden', { hiddenFrom: true }), person('author')],
      }),
    );
    expect(plan).toEqual([
      { recipientId: 'author', kind: 'comment' },
      { recipientId: 'stranger', kind: 'thread' },
    ]);
  });

  it('on a friends post, tells only participants who can see both the post and this comment', () => {
    const plan = planCommentNotices(
      event({
        participants: [
          person('mutual', { friendOfAuthor: true, friendOfActor: true }),
          person('authorOnly', { friendOfAuthor: true }),
          person('actorOnly', { friendOfActor: true }),
          person('hiddenMutual', { friendOfAuthor: true, friendOfActor: true, hiddenFrom: true }),
        ],
      }),
    );
    expect(plan).toEqual([
      { recipientId: 'author', kind: 'comment' },
      { recipientId: 'mutual', kind: 'thread' },
    ]);
  });

  it('counts a comment by the post author as visible to every friend of the author', () => {
    const plan = planCommentNotices(
      event({ actorId: 'author', replyToMemberId: 'third', replyTarget: person('third', { friendOfActor: true, friendOfAuthor: true }), participants: [person('friend', { friendOfAuthor: true, friendOfActor: true })] }),
    );
    expect(plan).toEqual([{ recipientId: 'third', kind: 'reply' }]);
    const withThread = planCommentNotices(
      event({
        actorId: 'author',
        replyToMemberId: 'third',
        replyTarget: person('third', { friendOfActor: true, friendOfAuthor: true }),
        participants: [person('friendOfThird', { friendOfAuthor: true, friendOfActor: true, friendOfReplyTo: true })],
      }),
    );
    expect(withThread).toEqual([
      { recipientId: 'third', kind: 'reply' },
      { recipientId: 'friendOfThird', kind: 'thread' },
    ]);
  });

  it('needs the member answered to be visible too on a friends post', () => {
    const target = person('third', { friendOfActor: true, friendOfAuthor: true });
    const plan = planCommentNotices(
      event({
        replyToMemberId: 'third',
        replyTarget: target,
        participants: [
          person('seesBoth', { friendOfAuthor: true, friendOfActor: true, friendOfReplyTo: true }),
          person('seesActorOnly', { friendOfAuthor: true, friendOfActor: true }),
        ],
      }),
    );
    expect(plan.map((notice) => `${notice.kind}:${notice.recipientId}`)).toEqual(['reply:third', 'comment:author', 'thread:seesBoth']);
  });

  it('never sends thread notices on a private post', () => {
    expect(planCommentNotices(event({ audience: 'private', actorId: 'author', participants: [person('x', { friendOfAuthor: true, friendOfActor: true })] }))).toEqual([]);
  });

  it('keeps one notice per member, the most recent first, and at most MOMENT_THREAD_RECIPIENTS_MAX', () => {
    const participants = Array.from({ length: MOMENT_THREAD_RECIPIENTS_MAX + 10 }, (_, index) =>
      person(`m${String(index).padStart(3, '0')}`, { lastAt: new Date(Date.UTC(2026, 9, 1) + index * 60_000).toISOString() }),
    );
    participants.push(person('m000', { lastAt: '2027-01-01T00:00:00.000Z' }));
    const plan = planCommentNotices(event({ audience: 'club', participants }));
    const threads = plan.filter((notice) => notice.kind === 'thread').map((notice) => notice.recipientId);
    expect(threads).toHaveLength(MOMENT_THREAD_RECIPIENTS_MAX);
    expect(new Set(threads).size).toBe(threads.length);
    expect(threads[0]).toBe('m000');
    expect(threads[1]).toBe(`m${String(MOMENT_THREAD_RECIPIENTS_MAX + 9).padStart(3, '0')}`);
    expect(threads).not.toContain('m001');
  });

  it('applies the cap after leaving out those who cannot see, so hidden members do not use places', () => {
    const hidden = Array.from({ length: MOMENT_THREAD_RECIPIENTS_MAX }, (_, index) => person(`h${index}`, { hiddenFrom: true, lastAt: '2027-01-01T00:00:00.000Z' }));
    const plan = planCommentNotices(event({ audience: 'club', participants: [...hidden, person('visible')] }));
    expect(plan.map((notice) => notice.recipientId)).toEqual(['author', 'visible']);
  });
});

describe('planLikeNotice', () => {
  it('tells the author about someone else’s like only', () => {
    expect(planLikeNotice('author', 'friend')).toEqual({ recipientId: 'author', kind: 'like' });
    expect(planLikeNotice('author', 'author')).toBeNull();
  });
});
