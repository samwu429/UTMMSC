import type { ChannelAudience } from '@utmmsc/shared';
import { canReadChannel, type ActorInput } from '../../domain/authorization/channel-access';
import { audienceReaderChanges } from '../../domain/messaging/visibility';
import { isMissingSchemaError, type ChannelRow } from './channels';
import { viewedActor, type MemberAccessRow } from './members';
import { nowIso } from './time';

/** Ids per statement, with room left for the other bound values under D1's limit of 100. */
/** 每条语句的 id 数量，在 D1 每条 100 个参数的上限内为其他绑定值留出空间。 */
const IDS_PER_STATEMENT = 90;

function chunks(ids: readonly string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += IDS_PER_STATEMENT) out.push(ids.slice(i, i + IDS_PER_STATEMENT));
  return out;
}

function placeholders(ids: readonly string[]): string {
  return ids.map(() => '?').join(', ');
}

/**
 * Join times for audience channels (everything except 'all' and 'custom'). A row exists only when a role
 * or enrollment change, or a restored account, made the member newly eligible; otherwise the history
 * policy falls back to account and channel creation times.
 * 受众频道（'all' 和 'custom' 以外）的加入时间。只有身份或在读状态的变化、或恢复账号使成员新获得资格时才有记录；否则历史策略按账号和频道的创建时间计算。
 */

export async function listImplicitJoins(db: D1Database, memberId: string): Promise<Map<string, string>> {
  try {
    const result = await db
      .prepare('SELECT channel_id, joined_at FROM channel_joins WHERE member_id = ?')
      .bind(memberId)
      .all<{ channel_id: string; joined_at: string }>();
    return new Map(result.results.map((r) => [r.channel_id, r.joined_at]));
  } catch (err) {
    if (isMissingSchemaError(err)) return new Map();
    throw err;
  }
}

/** Recorded join times in one channel, by member. */
/** 某个频道中已记录的加入时间，按成员区分。 */
export async function listChannelJoins(db: D1Database, channelId: string): Promise<Map<string, string>> {
  try {
    const result = await db
      .prepare('SELECT member_id, joined_at FROM channel_joins WHERE channel_id = ?')
      .bind(channelId)
      .all<{ member_id: string; joined_at: string }>();
    return new Map(result.results.map((r) => [r.member_id, r.joined_at]));
  } catch (err) {
    if (isMissingSchemaError(err)) return new Map();
    throw err;
  }
}

/**
 * Records join and leave for every audience channel whose readability changed between two versions
 * of the same member, for example after a promotion or an enrollment correction. A null `before` means the
 * member could read nothing, as when a disabled account is restored.
 * 对同一成员前后两个版本之间可读性发生变化的每个受众频道，记录加入或离开，例如升职或更正在读状态之后。`before` 为 null
 * 表示成员之前什么都不能读，例如恢复已停用的账号时。
 */
export async function recordEligibilityChange(
  db: D1Database,
  memberId: string,
  before: ActorInput | null,
  after: ActorInput,
  channels: readonly Pick<ChannelRow, 'id' | 'audience' | 'post_policy'>[],
): Promise<void> {
  const ts = nowIso();
  const statements: D1PreparedStatement[] = [];
  for (const channel of channels) {
    if (channel.audience === 'custom' || channel.audience === 'all') continue;
    const access = { audience: channel.audience, postPolicy: channel.post_policy, isMember: false };
    const wasReader = before !== null && canReadChannel(access, before);
    const isReader = canReadChannel(access, after);
    if (!wasReader && isReader) {
      statements.push(
        db
          .prepare(
            'INSERT INTO channel_joins (channel_id, member_id, joined_at) VALUES (?, ?, ?) ON CONFLICT (channel_id, member_id) DO UPDATE SET joined_at = excluded.joined_at',
          )
          .bind(channel.id, memberId, ts),
      );
    } else if (wasReader && !isReader) {
      statements.push(db.prepare('DELETE FROM channel_joins WHERE channel_id = ? AND member_id = ?').bind(channel.id, memberId));
    }
  }
  if (statements.length === 0) return;
  try {
    await db.batch(statements);
  } catch (err) {
    if (!isMissingSchemaError(err)) throw err;
  }
}

/**
 * Records join and leave for every active member whose readability changed because an admin moved a channel
 * to another audience. Members who can newly read it join now instead of falling back to their account
 * creation time; members who can no longer read it lose their recorded join. Membership lists are the ones
 * before and after the edit, used only on the side whose audience is custom.
 * 管理员把频道改为其他受众后，为可读性因此变化的每位在用成员记录加入或离开。新能阅读的成员从现在开始加入，而不是退回到账号创建时间；
 * 不再能阅读的成员删除已记录的加入时间。成员名单是编辑前后的名单，只在受众为指定成员的一侧使用。
 */
export async function recordAudienceChange(
  db: D1Database,
  channel: Pick<ChannelRow, 'id' | 'audience' | 'post_policy'>,
  nextAudience: ChannelAudience,
  memberships: { before: ReadonlySet<string>; after: ReadonlySet<string> },
): Promise<void> {
  if (channel.audience === nextAudience) return;
  const result = await db
    .prepare("SELECT id, role, acting_role, enrollment_status FROM members WHERE status = 'active'")
    .all<Omit<MemberAccessRow, 'created_at'>>();
  const { joined, left } = audienceReaderChanges({
    previousAudience: channel.audience,
    nextAudience,
    postPolicy: channel.post_policy,
    candidates: result.results.map((row) => ({
      id: row.id,
      ...viewedActor(row),
      wasMember: memberships.before.has(row.id),
      isMember: memberships.after.has(row.id),
    })),
  });
  const ts = nowIso();
  // Listed members who keep reading after a custom channel opens to an audience carry their tracked
  // membership join time over, instead of falling back to account or channel creation.
  // 指定成员频道改为按受众开放后，仍能阅读的原成员沿用已记录的入群时间，而不是退回账号或频道的创建时间。
  const leftSet = new Set(left);
  const retained =
    channel.audience === 'custom' && nextAudience !== 'custom'
      ? result.results.map((row) => row.id).filter((id) => memberships.before.has(id) && !leftSet.has(id))
      : [];
  const statements: D1PreparedStatement[] = [
    ...chunks(retained).map((slice) =>
      db
        .prepare(
          `INSERT INTO channel_joins (channel_id, member_id, joined_at)
           SELECT channel_id, member_id, joined_at FROM channel_memberships
           WHERE channel_id = ? AND join_tracked = 1 AND member_id IN (${placeholders(slice)})
           ON CONFLICT (channel_id, member_id) DO UPDATE SET joined_at = excluded.joined_at`,
        )
        .bind(channel.id, ...slice),
    ),
    // Selecting from members skips anyone deleted since the read, so one missing row cannot fail the batch on its foreign key.
    // 从 members 中选取会跳过读取之后被删除的成员，单个缺失的行不会因外键而使整组语句失败。
    ...chunks(joined).map((slice) =>
      db
        .prepare(
          `INSERT INTO channel_joins (channel_id, member_id, joined_at) SELECT ?, id, ? FROM members WHERE id IN (${placeholders(slice)})
           ON CONFLICT (channel_id, member_id) DO UPDATE SET joined_at = excluded.joined_at`,
        )
        .bind(channel.id, ts, ...slice),
    ),
    ...chunks(left).map((slice) =>
      db.prepare(`DELETE FROM channel_joins WHERE channel_id = ? AND member_id IN (${placeholders(slice)})`).bind(channel.id, ...slice),
    ),
  ];
  if (statements.length === 0) return;
  try {
    await db.batch(statements);
  } catch (err) {
    if (!isMissingSchemaError(err)) throw err;
  }
}
