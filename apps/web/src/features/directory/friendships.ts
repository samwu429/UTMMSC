import type { FriendSummary, FriendshipState, MemberProfile } from '@utmmsc/shared';
import { sameJson } from '../../shared/session/store';

/**
 * The new page of members, keeping the object a member already had when its data is unchanged, so a refined search
 * re-renders only the rows that are new or changed instead of all of them.
 * 新的一页成员；数据未变的成员沿用原有对象，细化搜索时只有新增或变化的行会重新渲染，而不是全部重新渲染。
 */
export function keepUnchanged(prev: readonly MemberProfile[], next: readonly MemberProfile[]): MemberProfile[] {
  const known = new Map(prev.map((member) => [member.id, member]));
  return next.map((member) => {
    const old = known.get(member.id);
    return old && sameJson(old, member) ? old : member;
  });
}

/**
 * The member's friendships as sets, built once per summary, so each directory row is a constant-time lookup
 * instead of a scan of every friend list on every keystroke.
 * 成员的好友关系整理成集合，每份概要只构建一次；目录中的每一行因此是常数时间的查找，而不是每次按键都扫描所有好友列表。
 */
export interface FriendshipIndex {
  selfId: string | null;
  friends: ReadonlySet<string>;
  outgoing: ReadonlySet<string>;
  incoming: ReadonlySet<string>;
}

export function indexFriendships(summary: FriendSummary | null, selfId: string | null | undefined): FriendshipIndex {
  return {
    selfId: selfId ?? null,
    friends: new Set(summary?.friendIds ?? []),
    outgoing: new Set(summary?.outgoingIds ?? []),
    incoming: new Set((summary?.incoming ?? []).map((card) => card.member.id)),
  };
}

/** Self first, then friends, then a request either way; the same order the rows always used. */
/** 先判断自己，再判断好友，然后是双方各自的申请；与各行一直使用的顺序相同。 */
export function friendshipOf(index: FriendshipIndex, id: string): FriendshipState {
  if (id === index.selfId) return 'self';
  if (index.friends.has(id)) return 'friends';
  if (index.outgoing.has(id)) return 'outgoing';
  if (index.incoming.has(id)) return 'incoming';
  return 'none';
}

/** The summary after a request: friends at once when they had asked first, otherwise one more outgoing request. */
/** 发出申请后的概要：对方先申请过就直接成为好友，否则多一条发出的申请。 */
export function afterRequest(prev: FriendSummary | null, id: string, friendship: FriendshipState): FriendSummary {
  const base = prev ?? { incoming: [], outgoingIds: [], friendIds: [] };
  if (friendship === 'friends') return afterAccept(base, id);
  return { ...base, outgoingIds: base.outgoingIds.includes(id) ? base.outgoingIds : [...base.outgoingIds, id] };
}

/** The summary after accepting someone's request, or after a request that made the two friends. */
/** 通过对方申请之后的概要，或者发出申请后双方直接成为好友时的概要。 */
export function afterAccept(prev: FriendSummary | null, id: string): FriendSummary {
  const base = prev ?? { incoming: [], outgoingIds: [], friendIds: [] };
  return {
    ...base,
    friendIds: base.friendIds.includes(id) ? base.friendIds : [...base.friendIds, id],
    incoming: base.incoming.filter((card) => card.member.id !== id),
    outgoingIds: base.outgoingIds.filter((item) => item !== id),
  };
}
