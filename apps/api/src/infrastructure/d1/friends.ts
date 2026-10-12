import type { FriendCard, FriendEdge, FriendSummary, FriendshipState } from '@utmmsc/shared';
import { friendshipState } from '@utmmsc/shared';
import { randomId } from '../../domain/crypto/encoding';
import { findMemberById, toProfile } from './members';
import { nowIso } from './time';

interface FriendRow {
  id: string;
  from_id: string;
  to_id: string;
  status: FriendEdge['status'];
  created_at: string;
  updated_at: string;
}

function toEdge(row: FriendRow): FriendEdge {
  return { fromId: row.from_id, toId: row.to_id, status: row.status };
}

export async function edgesBetween(db: D1Database, a: string, b: string): Promise<FriendEdge[]> {
  const result = await db
    .prepare('SELECT * FROM friend_requests WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)')
    .bind(a, b, b, a)
    .all<FriendRow>();
  return result.results.map(toEdge);
}

export async function areFriends(db: D1Database, a: string, b: string): Promise<boolean> {
  return friendshipState(a, b, await edgesBetween(db, a, b)) === 'friends';
}

export async function relation(db: D1Database, me: string, them: string): Promise<FriendshipState> {
  return friendshipState(me, them, await edgesBetween(db, me, them));
}

async function findDirected(db: D1Database, fromId: string, toId: string): Promise<FriendRow | null> {
  return db.prepare('SELECT * FROM friend_requests WHERE from_id = ? AND to_id = ?').bind(fromId, toId).first<FriendRow>();
}

async function setStatus(db: D1Database, id: string, status: FriendEdge['status']): Promise<void> {
  await db.prepare('UPDATE friend_requests SET status = ?, updated_at = ? WHERE id = ?').bind(status, nowIso(), id).run();
}

/**
 * Asks to be friends. If the other person already asked, this accepts their request.
 * 发出好友申请。如果对方已经申请过，这里直接通过。
 */
export async function requestFriend(db: D1Database, fromId: string, toId: string): Promise<FriendshipState> {
  const current = await relation(db, fromId, toId);
  if (current === 'friends' || current === 'outgoing') return current;
  if (current === 'incoming') {
    const incoming = await findDirected(db, toId, fromId);
    if (incoming) await setStatus(db, incoming.id, 'accepted');
    return 'friends';
  }
  const existing = await findDirected(db, fromId, toId);
  if (existing) await setStatus(db, existing.id, 'pending');
  else await db.prepare('INSERT INTO friend_requests (id, from_id, to_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').bind(randomId('frq'), fromId, toId, 'pending', nowIso(), nowIso()).run();
  return 'outgoing';
}

export async function respondFriend(db: D1Database, me: string, them: string, accept: boolean): Promise<FriendshipState> {
  const incoming = await findDirected(db, them, me);
  if (!incoming || incoming.status !== 'pending') return relation(db, me, them);
  await setStatus(db, incoming.id, accept ? 'accepted' : 'rejected');
  return accept ? 'friends' : 'none';
}

export async function listFriendIds(db: D1Database, memberId: string): Promise<string[]> {
  const result = await db
    .prepare("SELECT from_id, to_id FROM friend_requests WHERE status = 'accepted' AND (from_id = ? OR to_id = ?)")
    .bind(memberId, memberId)
    .all<{ from_id: string; to_id: string }>();
  return result.results.map((row) => (row.from_id === memberId ? row.to_id : row.from_id));
}

export async function friendSummary(db: D1Database, memberId: string): Promise<FriendSummary> {
  const pending = await db
    .prepare("SELECT * FROM friend_requests WHERE status = 'pending' AND (to_id = ? OR from_id = ?)")
    .bind(memberId, memberId)
    .all<FriendRow>();
  const incoming: FriendCard[] = [];
  const outgoingIds: string[] = [];
  for (const row of pending.results) {
    const otherId = row.to_id === memberId ? row.from_id : row.to_id;
    if (row.to_id === memberId) {
      const member = await findMemberById(db, otherId);
      if (member) incoming.push({ member: toProfile(member), requestedAt: row.created_at });
    } else {
      outgoingIds.push(otherId);
    }
  }
  return { incoming, outgoingIds, friendIds: await listFriendIds(db, memberId) };
}
