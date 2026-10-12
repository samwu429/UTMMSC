export const FRIENDSHIP_STATES = ['self', 'none', 'outgoing', 'incoming', 'friends'] as const;
export type FriendshipState = (typeof FRIENDSHIP_STATES)[number];

export interface FriendEdge {
  fromId: string;
  toId: string;
  status: 'pending' | 'accepted' | 'rejected';
}

/** How two members relate, ignoring rejected requests so either person can ask again. */
/** 两人的好友关系。已拒绝的申请不算数，双方可以再申请。 */
export function friendshipState(me: string, them: string, edges: FriendEdge[]): FriendshipState {
  if (me === them) return 'self';
  const relevant = edges.filter((edge) => (edge.fromId === me && edge.toId === them) || (edge.fromId === them && edge.toId === me));
  if (relevant.some((edge) => edge.status === 'accepted')) return 'friends';
  if (relevant.some((edge) => edge.status === 'pending' && edge.toId === me)) return 'incoming';
  if (relevant.some((edge) => edge.status === 'pending' && edge.fromId === me)) return 'outgoing';
  return 'none';
}
