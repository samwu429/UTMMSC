import {
  canSeeMomentInteraction,
  canSeeMomentPost,
  MOMENT_THREAD_RECIPIENTS_MAX,
  type MomentAudience,
  type MomentViewer,
} from '@utmmsc/shared';

/** One in-app notice to write. comment and reply also push; thread stays in the app. */
/** 要写入的一条应用内消息。comment 和 reply 还会推送；thread 只在应用内显示。 */
export interface PlannedNotice {
  recipientId: string;
  kind: 'comment' | 'reply' | 'thread';
}

/** Visibility facts about one member, as the D1 layer reads them for this comment. */
/** 某位成员与这条评论有关的可见性信息，由 D1 层读取。 */
export interface Participant {
  memberId: string;
  /** Their latest like or comment on the post, for most-recent-first ordering. */
  /** 此人在这条动态上最近一次点赞或评论的时间，用于按最近优先排序。 */
  lastAt: string;
  friendOfActor: boolean;
  friendOfReplyTo: boolean;
  friendOfAuthor: boolean;
  /** The post author chose 不让TA看 for this member. */
  /** 动态作者对此人设置了「不让TA看」。 */
  hiddenFrom: boolean;
}

export interface CommentEvent {
  postAuthorId: string;
  audience: MomentAudience;
  actorId: string;
  /** The member answered, already checked to be active; null for a plain comment. */
  /** 被回复的成员（已确认仍在用）；普通评论为 null。 */
  replyToMemberId: string | null;
  /** Visibility facts for the member answered. */
  /** 被回复成员的可见性信息。 */
  replyTarget: Participant | null;
  /** Earlier likers and commenters. */
  /** 此前点赞和评论的人。 */
  participants: Participant[];
}

/**
 * The participant as a viewer for the shared rules. Their friendships are known only towards the actor, the
 * member answered and the post author, which are the only ids the rules ask about here.
 * 把参与者当作查看者交给共享规则。只知道此人与评论者、被回复者和动态作者之间的好友关系，而这里的规则也只会问到这几个人。
 */
function asViewer(event: CommentEvent, person: Participant): MomentViewer {
  const friendIds = new Set<string>();
  if (person.friendOfActor) friendIds.add(event.actorId);
  if (person.friendOfReplyTo && event.replyToMemberId) friendIds.add(event.replyToMemberId);
  if (person.friendOfAuthor) friendIds.add(event.postAuthorId);
  return { id: person.memberId, friendIds };
}

/** The post is live, since only a live post takes comments, and its author is active. */
/** 动态仍在显示（只有这样的动态才能评论），作者也仍在用。 */
function seesPost(event: CommentEvent, person: Participant): boolean {
  return canSeeMomentPost(asViewer(event, person), {
    authorId: event.postAuthorId,
    authorActive: true,
    audience: event.audience,
    removed: false,
    hiddenFromViewer: person.hiddenFrom,
  });
}

function seesComment(event: CommentEvent, person: Participant): boolean {
  const post = { authorId: event.postAuthorId, audience: event.audience };
  return canSeeMomentInteraction(asViewer(event, person), post, event.actorId, event.replyToMemberId);
}

/** Most recent first; ties by id, so the plan never depends on the order the rows arrived in. */
/** 最近的优先；时间相同时按 id 排序，因此结果不受记录到达顺序的影响。 */
function byRecent(a: Participant, b: Participant): number {
  if (a.lastAt !== b.lastAt) return a.lastAt < b.lastAt ? 1 : -1;
  if (a.memberId !== b.memberId) return a.memberId < b.memberId ? -1 : 1;
  return 0;
}

/**
 * Who hears about a new comment, in order: never the actor; the reply target, if they can still see the post,
 * gets reply; the post author, unless they are the reply target, gets comment; then participants not already
 * covered get thread, only if they can still see the post (club: not hidden from; friends: friend of the author
 * and not hidden from) and this comment (club: yes; friends: the actor is their friend or the post author, and
 * the reply target is visible to them), at most MOMENT_THREAD_RECIPIENTS_MAX, most recent first.
 * 新评论按以下顺序通知：从不通知评论者本人；被回复者若仍能看到这条动态，收到 reply；动态作者（除非就是被回复者）收到 comment；
 * 其余尚未通知的参与者收到 thread，前提是仍能看到这条动态（全社团：没有被设置「不让TA看」；好友：是作者的好友且没有被设置「不让TA看」），
 * 并且能看到这条评论（全社团：能；好友：评论者是其好友或动态作者，且能看到被回复者），最多 MOMENT_THREAD_RECIPIENTS_MAX 人，最近的优先。
 */
export function planCommentNotices(event: CommentEvent): PlannedNotice[] {
  const planned: PlannedNotice[] = [];
  const covered = new Set<string>([event.actorId]);
  const target = event.replyToMemberId;
  if (target !== null && !covered.has(target)) {
    covered.add(target);
    const facts = event.replyTarget?.memberId === target ? event.replyTarget : null;
    if (target === event.postAuthorId || (facts !== null && seesPost(event, facts))) planned.push({ recipientId: target, kind: 'reply' });
  }
  if (!covered.has(event.postAuthorId)) {
    covered.add(event.postAuthorId);
    planned.push({ recipientId: event.postAuthorId, kind: 'comment' });
  }
  const latest = new Map<string, Participant>();
  for (const person of event.participants) {
    if (covered.has(person.memberId)) continue;
    const seen = latest.get(person.memberId);
    if (!seen || byRecent(person, seen) < 0) latest.set(person.memberId, person);
  }
  const threads = [...latest.values()]
    .filter((person) => seesPost(event, person) && seesComment(event, person))
    .sort(byRecent)
    .slice(0, MOMENT_THREAD_RECIPIENTS_MAX);
  for (const person of threads) planned.push({ recipientId: person.memberId, kind: 'thread' });
  return planned;
}

/** A like notice for the post author, or null when the author liked their own post. */
/** 给动态作者的点赞消息；作者给自己点赞时为 null。 */
export function planLikeNotice(postAuthorId: string, actorId: string): { recipientId: string; kind: 'like' } | null {
  return postAuthorId === actorId ? null : { recipientId: postAuthorId, kind: 'like' };
}
