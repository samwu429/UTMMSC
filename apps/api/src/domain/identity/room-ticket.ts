import type { Role } from '@utmmsc/shared';
import { signPayload, verifyPayload } from '../crypto/hmac';

/**
 * Browsers cannot attach headers to WebSocket upgrades, so the client first obtains a short-lived
 * ticket over HTTPS and presents it in the upgrade URL. The ticket carries everything the room needs.
 * 浏览器无法给 WebSocket 升级请求加头，因此客户端先通过 HTTPS 领取短期票据，再放在升级 URL 中。票据包含房间所需的全部信息。
 */
export const ROOM_TICKET_TTL_MS = 60 * 1000;

export interface RoomTicketClaims {
  kind: 'room';
  roomId: string;
  memberId: string;
  displayName: string;
  role: Role;
  canPost: boolean;
  exp: number;
}

export async function issueRoomTicket(secret: string, claims: Omit<RoomTicketClaims, 'kind' | 'exp'>, now: Date = new Date()): Promise<string> {
  const full: RoomTicketClaims = { kind: 'room', ...claims, exp: now.getTime() + ROOM_TICKET_TTL_MS };
  return signPayload(secret, full);
}

export async function readRoomTicket(secret: string, ticket: string, now: Date = new Date()): Promise<RoomTicketClaims | null> {
  const claims = await verifyPayload<RoomTicketClaims>(secret, ticket);
  if (!claims || claims.kind !== 'room') return null;
  if (typeof claims.roomId !== 'string' || typeof claims.memberId !== 'string') return null;
  if (typeof claims.exp !== 'number' || claims.exp <= now.getTime()) return null;
  return claims;
}
