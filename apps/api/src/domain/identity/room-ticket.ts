import type { Role, RoomAccess } from '@utmmsc/shared';
import { signPayload, verifyPayload } from '../crypto/hmac';
import { coerceRoomAccess } from '../messaging/visibility';

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
  avatarKey?: string | null;
  /** History floor computed by the Worker when the ticket was issued. */
  /** Worker 签发票据时计算出的历史下限。 */
  access: RoomAccess;
  /** Unique id; the room accepts each ticket once. */
  /** 唯一编号；房间对每张票据只接受一次。 */
  jti: string;
  exp: number;
}

/** Omitting access issues a ticket with no history floor, the same as a ticket from before the floor existed. */
/** 不传 access 时签发的票据没有历史下限，与下限功能出现之前的票据相同。 */
export type RoomTicketInput = Omit<RoomTicketClaims, 'kind' | 'exp' | 'jti' | 'access'> & { access?: RoomAccess };

export async function issueRoomTicket(secret: string, claims: RoomTicketInput, now: Date = new Date()): Promise<string> {
  const full: RoomTicketClaims = {
    kind: 'room',
    ...claims,
    access: coerceRoomAccess(claims.access),
    jti: crypto.randomUUID(),
    exp: now.getTime() + ROOM_TICKET_TTL_MS,
  };
  return signPayload(secret, full);
}

export async function readRoomTicket(secret: string, ticket: string, now: Date = new Date()): Promise<RoomTicketClaims | null> {
  const claims = await verifyPayload<RoomTicketClaims>(secret, ticket);
  if (!claims || claims.kind !== 'room') return null;
  if (typeof claims.roomId !== 'string' || typeof claims.memberId !== 'string' || typeof claims.jti !== 'string') return null;
  if (typeof claims.exp !== 'number' || claims.exp <= now.getTime()) return null;
  // A ticket issued before access existed, or with a malformed value, gets no floor.
  // 在 access 字段出现之前签发、或该字段格式不对的票据，一律不设下限。
  return { ...claims, access: coerceRoomAccess(claims.access) };
}
