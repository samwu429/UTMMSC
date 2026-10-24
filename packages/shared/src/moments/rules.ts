/** Who may see a moment and its interactions. The D1 queries mirror these and a property test checks both agree. */
/** 谁能看到一条动态及其互动。D1 查询与这些函数一致，并有属性测试核对两者结果相同。 */
import { decideModeration } from '../chat/moderation';
import type { Role } from '../identity/roles';
import type { MomentAudience } from './types';

export interface MomentViewer {
  id: string;
  /** The viewer's accepted friends. Never contains the viewer. */
  /** 查看者已通过的好友。不包含查看者本人。 */
  friendIds: ReadonlySet<string>;
}

export interface MomentPostFacts {
  authorId: string;
  authorActive: boolean;
  audience: MomentAudience;
  /** A moderator removed the post. */
  /** 管理员已移除这条动态。 */
  removed: boolean;
  /** The author chose 不让TA看 for this viewer. */
  /** 作者对这位查看者设置了「不让TA看」。 */
  hiddenFromViewer: boolean;
}

/**
 * The author always sees their own posts, removed ones included, while the account is active. Anyone else
 * needs a live post that is not hidden from them: club posts reach every member, friends posts reach the
 * author's friends, and private posts reach nobody else.
 * 账号在用期间，作者总能看到自己的动态，包括已被移除的。其他人需要动态未被移除、也没有对自己设置「不让TA看」：
 * 全社团动态所有成员可见，好友动态作者的好友可见，仅自己可见的动态其他人都看不到。
 */
export function canSeeMomentPost(viewer: MomentViewer, post: MomentPostFacts): boolean {
  if (!post.authorActive) return false;
  if (post.authorId === viewer.id) return true;
  if (post.removed || post.hiddenFromViewer) return false;
  if (post.audience === 'club') return true;
  if (post.audience === 'friends') return viewer.friendIds.has(post.authorId);
  return false;
}

/** The home feed also skips authors the viewer chose 不看TA for, but never the viewer's own posts. */
/** 动态首页还会跳过查看者设置了「不看TA」的作者，但不会跳过查看者自己的动态。 */
export function showsOnHomeFeed(viewer: MomentViewer, post: MomentPostFacts, viewerMutedAuthor: boolean): boolean {
  return canSeeMomentPost(viewer, post) && (post.authorId === viewer.id || !viewerMutedAuthor);
}

/**
 * Club posts show every interaction to everyone who can see them. On friends and private posts a viewer
 * sees interactions by themselves, the post author and their own friends, and the author sees all of them;
 * "A 回复 B" needs both A and B to pass. replyToId is null for a plain comment and for a reply whose target
 * is no longer active.
 * 全社团动态的所有互动对能看到它的人都可见。好友动态和仅自己可见的动态上，查看者能看到自己、动态作者和自己好友的互动，
 * 作者能看到全部互动；「A 回复 B」需要 A 和 B 都满足条件。普通评论的 replyToId 为 null；被回复者已停用时也为 null。
 */
export function canSeeMomentInteraction(
  viewer: MomentViewer,
  post: Pick<MomentPostFacts, 'authorId' | 'audience'>,
  actorId: string,
  replyToId: string | null,
): boolean {
  const sees = (id: string) =>
    post.audience === 'club' || viewer.id === post.authorId || id === viewer.id || id === post.authorId || viewer.friendIds.has(id);
  return sees(actorId) && (replyToId === null || sees(replyToId));
}

/** Likes and comments need a post the member can see that a moderator has not removed, even for its author. */
/** 点赞和评论要求成员能看到这条动态，且它没有被管理员移除，作者本人也一样。 */
export function canInteractWithMoment(viewer: MomentViewer, post: MomentPostFacts): boolean {
  return canSeeMomentPost(viewer, post) && !post.removed;
}

/** What a reply needs to know about the comment it answers. */
/** 回复时需要知道的被回复评论的信息。 */
export interface MomentCommentFacts {
  postId: string;
  authorId: string;
  authorActive: boolean;
  /** The member this comment itself answered, when still active. */
  /** 这条评论本身回复的成员（仍在用时）。 */
  replyToId: string | null;
  removed: boolean;
}

/**
 * A reply needs a post the member can interact with, and a live comment on that post by someone else that
 * the member can see. The route stores an answer to one's own comment as a plain comment instead.
 * 回复要求成员能对这条动态互动，且被回复的是同一条动态上别人发的、成员能看到的、未被移除的评论。
 * 回复自己的评论时，接口改为按普通评论保存。
 */
export function canReplyToMomentComment(viewer: MomentViewer, postId: string, post: MomentPostFacts, comment: MomentCommentFacts): boolean {
  if (!canInteractWithMoment(viewer, post)) return false;
  if (comment.postId !== postId || comment.removed || !comment.authorActive) return false;
  if (comment.authorId === viewer.id) return false;
  return canSeeMomentInteraction(viewer, post, comment.authorId, comment.replyToId);
}

/** The comment's author or the post's author may delete a comment for good. */
/** 评论作者或动态作者可以彻底删除评论。 */
export function canDeleteMomentComment(viewerId: string, comment: { authorId: string }, post: { authorId: string }): boolean {
  return viewerId === comment.authorId || viewerId === post.authorId;
}

export type MomentModerationDecision = 'ok' | 'no_permission' | 'outranked';

/**
 * The channel rule of chat moderation: chat.moderate, and a target in a lower tier unless the actor is the
 * system admin. targetRole is null when the account no longer exists.
 * 沿用聊天频道的管理规则：需要 chat.moderate，且对方档位更低，系统管理员除外。账号已不存在时 targetRole 为 null。
 */
export function decideMomentModeration(actorRole: Role, targetRole: Role | null): MomentModerationDecision {
  const decision = decideModeration({ roomKind: 'channel', actorRole, targetRole });
  return decision === 'direct' ? 'no_permission' : decision;
}

/** Moderators act on other people's content only; their own goes through the author's delete. */
/** 管理员只处理别人的内容；自己的内容按作者身份删除。 */
export function canModerateMoment(actor: { id: string; role: Role }, author: { id: string; role: Role | null }): boolean {
  return actor.id !== author.id && decideMomentModeration(actor.role, author.role) === 'ok';
}

/** Anyone who can see a post or comment may report it, except its author. */
/** 能看到动态或评论的人都可以投诉，作者本人除外。 */
export function canReportMoment(viewerId: string, contentAuthorId: string, visible: boolean): boolean {
  return visible && viewerId !== contentAuthorId;
}

const CLIENT_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** Ids the composer and the comment bar make, so a retry is recognised instead of posted twice. */
/** 编辑器和评论栏生成的 id，重试时据此识别，不会重复发表。 */
export function isMomentClientId(value: unknown): value is string {
  return typeof value === 'string' && CLIENT_ID.test(value);
}

/** Length in code points, so an emoji or a rare character counts once. */
/** 按码点计算的长度，一个表情或生僻字只算一个字。 */
export function momentTextLength(text: string): number {
  return Array.from(text).length;
}

/** C0 and C1 control characters, which the callers have already turned into newlines or spaces where they meant one. */
/** C0 和 C1 控制字符；表示换行或空格的那些，调用方已事先换成换行或空格。 */
function isControl(code: number): boolean {
  return code < 0x20 || (code >= 0x7f && code <= 0x9f);
}

function dropControls(text: string, keepNewline: boolean): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (keepNewline && ch === '\n') out += ch;
    else if (!isControl(code)) out += ch;
  }
  return out;
}

/**
 * Post text as stored: line breaks become \n, tabs become spaces, other control characters go, trailing
 * spaces on each line go, more than two blank lines in a row shrink to two, and the ends are trimmed.
 * 保存时的动态正文：换行统一为 \n，制表符换成空格，删去其他控制字符和每行末尾的空格，连续超过两行的空行缩成两行，并去掉首尾空白。
 */
export function normalizeMomentText(raw: string): string {
  const lines = raw.replace(/\r\n?|[\u2028\u2029]/g, '\n').replace(/\t/g, ' ');
  return dropControls(lines, true)
    .replace(/[^\S\n]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

/**
 * Comments are one line: line breaks and tabs become spaces, other control characters go, runs of spaces
 * shrink to one, and the ends are trimmed.
 * 评论只有一行：换行和制表符换成空格，删去其他控制字符，连续的空白缩成一个空格，并去掉首尾空白。
 */
export function normalizeMomentComment(raw: string): string {
  const flat = raw.replace(/\r\n?|[\n\t\u2028\u2029]/g, ' ');
  return dropControls(flat, false)
    .replace(/\s{2,}/g, ' ')
    .trim();
}
