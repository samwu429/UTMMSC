import type { ChannelAudience, EnrollmentStatus, HistoryVisibility, PostPolicy, RoomAccess, Role } from '@utmmsc/shared';
import { canReadChannel } from '../authorization/channel-access';

/**
 * History floor policy, following WeChat: a member who joins a channel after the policy instant only
 * sees messages from their join on. Members already present at that instant are grandfathered.
 * Anything missing or unreadable fails open, so a deploy that runs ahead of its migration never hides
 * history.
 * 历史下限策略，与微信一致：在策略生效时刻之后加入频道的成员，只能看到加入之后的消息。该时刻已在频道里的成员保留原有可见范围。
 * 任何缺失或无法解析的数据都按不设下限处理，因此先于迁移上线的版本不会隐藏历史。
 */

export const OPEN_ACCESS: RoomAccess = Object.freeze({ joinedAt: null, floorApplies: false });

export interface RoomAccessInput {
  kind: 'channel' | 'direct';
  audience?: ChannelAudience;
  /** Undefined when migration 0013 has not run. */
  /** 迁移 0013 尚未执行时为 undefined。 */
  historyVisibility?: HistoryVisibility | null;
  floorSince?: string | null;
  channelCreatedAt?: string | null;
  /** channel_memberships.joined_at, used for custom channels; null for rows written before join times were kept. */
  /** channel_memberships.joined_at，用于指定成员频道；在开始保留加入时间之前写入的行为 null。 */
  membershipJoinedAt?: string | null;
  /** channel_joins.joined_at, recorded when an admin change made the member newly eligible. */
  /** channel_joins.joined_at，在管理员的修改使成员新获得资格时记录。 */
  implicitJoinedAt?: string | null;
  memberCreatedAt?: string | null;
  /** True when the member's viewed role holds channels.manage. */
  /** 成员当前视角的身份拥有 channels.manage 时为 true。 */
  canManage: boolean;
}

function parse(iso: string | null | undefined): number | null {
  if (typeof iso !== 'string' || iso.length === 0) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function implicitJoinMs(input: Pick<RoomAccessInput, 'implicitJoinedAt' | 'memberCreatedAt' | 'channelCreatedAt'>): number | null {
  const implicit = parse(input.implicitJoinedAt);
  if (implicit !== null) return implicit;
  const memberCreated = parse(input.memberCreatedAt);
  const channelCreated = parse(input.channelCreatedAt);
  if (memberCreated === null || channelCreated === null) return null;
  return Math.max(memberCreated, channelCreated);
}

/**
 * When a member started reading a channel with an implicit audience: the recorded eligibility change,
 * else the later of account and channel creation. Null when neither can be read.
 * 成员开始阅读某个隐式受众频道的时间：有记录的资格变更时间，否则取账号创建与频道创建中较晚的一个。都无法读取时为 null。
 */
export function implicitJoinTime(input: Pick<RoomAccessInput, 'implicitJoinedAt' | 'memberCreatedAt' | 'channelCreatedAt'>): string | null {
  const ms = implicitJoinMs(input);
  return ms === null ? null : new Date(ms).toISOString();
}

function effectiveJoin(input: RoomAccessInput): number | null {
  if (input.audience === 'custom') return parse(input.membershipJoinedAt);
  return implicitJoinMs(input);
}

export function roomAccess(input: RoomAccessInput): RoomAccess {
  if (input.kind === 'direct') return OPEN_ACCESS;
  if (input.historyVisibility !== 'since_join' && input.historyVisibility !== 'all') return OPEN_ACCESS;

  const joined = effectiveJoin(input);
  if (joined === null) return OPEN_ACCESS;
  const policyStart = parse(input.floorSince) ?? parse(input.channelCreatedAt);
  if (policyStart === null) return OPEN_ACCESS;
  if (joined < policyStart) return OPEN_ACCESS;

  return {
    joinedAt: new Date(joined).toISOString(),
    floorApplies: input.historyVisibility === 'since_join' && !input.canManage,
  };
}

export interface ReaderCandidate {
  id: string;
  /** The viewed role, as used when the member opens the channel. */
  /** 当前视角的身份，与成员打开频道时使用的一致。 */
  role: Role;
  enrollmentStatus: EnrollmentStatus;
  createdAt: string;
}

/**
 * Members who could already read a channel under its previous implicit audience, mapped to the time
 * they started reading it. When the channel is narrowed to a member list these members keep the
 * history they could see and are not announced as newly invited; only the rest join now.
 * 在频道之前的隐式受众下已能阅读该频道的成员，以及其开始阅读的时间。频道收窄为指定成员时，这些成员保留原本能看到的历史，
 * 也不会被提示为新邀请；只有其余成员从现在开始加入。
 */
export function carriedReaderJoins(input: {
  previousAudience: ChannelAudience;
  postPolicy: PostPolicy;
  channelCreatedAt: string;
  candidates: readonly ReaderCandidate[];
  implicitJoins: ReadonlyMap<string, string>;
}): Map<string, string> {
  const carried = new Map<string, string>();
  if (input.previousAudience === 'custom') return carried;
  const channel = { audience: input.previousAudience, postPolicy: input.postPolicy, isMember: false };
  for (const candidate of input.candidates) {
    if (!canReadChannel(channel, { role: candidate.role, enrollmentStatus: candidate.enrollmentStatus })) continue;
    const at = implicitJoinTime({ implicitJoinedAt: input.implicitJoins.get(candidate.id), memberCreatedAt: candidate.createdAt, channelCreatedAt: input.channelCreatedAt });
    if (at) carried.set(candidate.id, at);
  }
  return carried;
}

export interface AudienceReader {
  id: string;
  /** The viewed role, as used when the member opens the channel. */
  /** 当前视角的身份，与成员打开频道时使用的一致。 */
  role: Role;
  enrollmentStatus: EnrollmentStatus;
  /** Membership row before the edit; only read when the previous audience is custom. */
  /** 编辑之前的成员记录；只在之前的受众为指定成员时使用。 */
  wasMember: boolean;
  /** Membership row after the edit; only read when the next audience is custom. */
  /** 编辑之后的成员记录；只在之后的受众为指定成员时使用。 */
  isMember: boolean;
}

/**
 * Who an audience edit lets in and who it shuts out. joined could not read the channel before and can now,
 * so they join at the edit; left lose access and drop any recorded join. A custom next audience records
 * its new readers as membership rows instead, so joined is empty there. Channel managers read every
 * channel either way and never appear.
 * 受众修改让谁进来、把谁挡在外面。joined 之前不能读该频道而现在可以，因此在这次修改时加入；left 失去访问权，删除已记录的加入时间。
 * 之后的受众为指定成员时，新读者以成员记录的形式保存，因此那时 joined 为空。频道管理者始终能读所有频道，永远不会出现在结果里。
 */
export function audienceReaderChanges(input: {
  previousAudience: ChannelAudience;
  nextAudience: ChannelAudience;
  postPolicy: PostPolicy;
  candidates: readonly AudienceReader[];
}): { joined: string[]; left: string[] } {
  const joined: string[] = [];
  const left: string[] = [];
  if (input.previousAudience === input.nextAudience) return { joined, left };
  for (const candidate of input.candidates) {
    const actor = { role: candidate.role, enrollmentStatus: candidate.enrollmentStatus };
    const wasReader = canReadChannel({ audience: input.previousAudience, postPolicy: input.postPolicy, isMember: candidate.wasMember }, actor);
    const isReader = canReadChannel({ audience: input.nextAudience, postPolicy: input.postPolicy, isMember: candidate.isMember }, actor);
    if (!wasReader && isReader && input.nextAudience !== 'custom') joined.push(candidate.id);
    else if (wasReader && !isReader) left.push(candidate.id);
  }
  return { joined, left };
}

/**
 * The activity time the chat list shows for a channel. A floored member sees the time of the newest
 * message they can read, or their join, never when the channel was last active before they joined.
 * 会话列表为频道显示的活动时间。受下限限制的成员看到的是其能读到的最新消息的时间，或其加入时间，绝不会看到加入之前频道最后活跃的时间。
 */
export function listActivityAt(access: RoomAccess, channelLastMessageAt: string | null, visibleLastMessageAt: string | null | undefined): string | null {
  if (!access.floorApplies) return channelLastMessageAt;
  return visibleLastMessageAt ?? access.joinedAt;
}

/** Tickets and socket headers cross a trust boundary in transit; anything malformed means no floor. */
/** 票据和连接头在传递中经过信任边界；格式不对时一律视为没有下限。 */
export function coerceRoomAccess(value: unknown): RoomAccess {
  if (typeof value !== 'object' || value === null) return OPEN_ACCESS;
  const record = value as Record<string, unknown>;
  const joinedAt = typeof record.joinedAt === 'string' && parse(record.joinedAt) !== null ? record.joinedAt : null;
  return { joinedAt, floorApplies: joinedAt !== null && record.floorApplies === true };
}
