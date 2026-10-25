import { Hono, type Context } from 'hono';
import {
  CHANNEL_AUDIENCES,
  CHANNEL_ICON_KEY_PREFIX,
  CHANNEL_ICON_MAX_BYTES,
  CHANNEL_ICON_SIZE,
  CHANNEL_ICON_THUMB_MAX_BYTES,
  CHANNEL_ICON_THUMB_SIZE,
  DEFAULT_HISTORY_VISIBILITY,
  HISTORY_VISIBILITIES,
  POST_POLICIES,
  channelIconExtension,
  channelIconPresetKey,
  channelIconThumbKey,
  channelRoomId,
  isChannelIconPresetId,
  isChannelIconType,
  isChannelIconUploadKey,
  type AdminChannelRow,
  type ChannelAudience,
  type ChannelIconResponse,
  type ChannelIconType,
  type HistoryVisibility,
  type PostPolicy,
} from '@utmmsc/shared';
import { randomId } from '../../../domain/crypto/encoding';
import { sniffImage } from '../../../domain/media/image-sniff';
import { issueProfileMediaToken } from '../../../domain/profile/media-token';
import {
  addChannelMembers,
  createChannel,
  deleteChannel,
  findChannel,
  isMissingSchemaError,
  listChannelMemberIds,
  listChannels,
  removeChannelMember,
  replaceChannelMembers,
  setChannelIcon,
  updateChannel,
  type ChannelPatch,
  type ChannelRow,
} from '../../../infrastructure/d1/channels';
import { carriedReaderJoins } from '../../../domain/messaging/visibility';
import { listChannelJoins, recordAudienceChange } from '../../../infrastructure/d1/channel-joins';
import { findAuthorCards, findMemberAccessRows, viewedActor, type MemberRow } from '../../../infrastructure/d1/members';
import { nowIso } from '../../../infrastructure/d1/time';
import { IMMUTABLE_MEDIA_CACHE, putObject } from '../../../infrastructure/r2/objects';
import type { Env } from '../../../env';
import { requireBucket } from '../../bindings';
import type { AppEnv } from '../../context';
import { badRequest, conflict, notFound, serviceUnavailable } from '../../errors';
import { recordRoomJoins, revokeRoom } from '../../rooms';
import { memberRateLimit } from '../../middleware/rate-limit';
import { requirePermission, requireSession } from '../../middleware/session';
import { optionalString, readJson, requireOneOf, requireString } from '../../validation';
import { MINUTE } from '../moments/common';

/** Channel administration. Reading and posting go through the chat routes. */
/** 频道管理。阅读与发言走 chat 路由。 */
export const channelRoutes = new Hono<AppEnv>();

channelRoutes.use('*', requireSession, requirePermission('channels.manage'));

const CHANNEL_MEMBERS_MAX = 1000;

function memberIdList(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || v.length === 0 || v.length > 64)) {
    throw badRequest('invalid_field', '成员列表格式错误');
  }
  if (value.length > CHANNEL_MEMBERS_MAX) throw badRequest('invalid_field', '成员过多');
  return [...new Set(value as string[])];
}

/** Rejects unknown ids up front instead of failing the insert on a foreign key. */
/** 预先拒绝不存在的成员，而不是让插入因外键失败。 */
async function requireExistingMembers(db: D1Database, ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += 90) {
    const slice = ids.slice(i, i + 90);
    const found = await db
      .prepare(`SELECT COUNT(*) AS n FROM members WHERE id IN (${slice.map(() => '?').join(', ')})`)
      .bind(...slice)
      .first<{ n: number }>();
    if ((found?.n ?? 0) !== slice.length) throw badRequest('unknown_member', '成员列表里有不存在的成员');
  }
}

function toAdminChannel(row: ChannelRow, memberIds: string[]): AdminChannelRow {
  const channel: AdminChannelRow = {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    audience: row.audience,
    postPolicy: row.post_policy,
    createdAt: row.created_at,
    lastMessageAt: row.last_message_at,
    memberIds,
    historyVisibility: row.history_visibility ?? DEFAULT_HISTORY_VISIBILITY,
  };
  // Left out before migration 0018, as the contract says, so a client can tell icons that are not available yet
  // from a channel that has none.
  // 迁移 0018 之前按约定不返回，客户端因此能区分「图标功能尚不可用」和「频道没有图标」。
  if (row.icon_key !== undefined) {
    channel.iconKey = row.icon_key;
    channel.iconUpdatedAt = row.icon_updated_at ?? null;
  }
  return channel;
}

/**
 * Writes the join notice for members an admin added to a custom channel. Runs after the membership
 * rows exist, so the notice is stamped no earlier than their join time and lands at their floor.
 * 为管理员加入指定成员频道的成员写入入群提示。在成员记录写入之后执行，提示的时间不早于其加入时间，正好位于其下限处。
 */
async function announceJoins(env: Env, channelId: string, actor: MemberRow, memberIds: string[]): Promise<void> {
  const ids = memberIds.filter((id) => id !== actor.id);
  if (ids.length === 0) return;
  const at = nowIso();
  const cards = await findAuthorCards(env.DB, ids);
  await recordRoomJoins(env, channelRoomId(channelId), {
    actor: { id: actor.id, displayName: actor.display_name },
    members: ids.map((id) => ({ id, displayName: cards.get(id)?.displayName ?? '' })),
    at,
  });
}

/**
 * Listed members who could already read the channel under its current implicit audience, with the time
 * they started reading it. Narrowing the channel to a member list keeps their history instead of
 * flooring them at the edit.
 * 名单中在频道当前的隐式受众下已能阅读该频道的成员，以及其开始阅读的时间。把频道收窄为指定成员时保留他们的历史，而不是从这次编辑开始限制。
 */
async function previousReaders(db: D1Database, channel: ChannelRow, memberIds: string[]): Promise<Map<string, string>> {
  const [rows, implicitJoins] = await Promise.all([findMemberAccessRows(db, memberIds), listChannelJoins(db, channel.id)]);
  return carriedReaderJoins({
    previousAudience: channel.audience,
    postPolicy: channel.post_policy,
    channelCreatedAt: channel.created_at,
    candidates: rows.map((row) => ({ id: row.id, ...viewedActor(row), createdAt: row.created_at })),
    implicitJoins,
  });
}

async function loadAdminChannel(db: D1Database, id: string) {
  const row = await findChannel(db, id);
  if (!row) return null;
  const memberIds = row.audience === 'custom' ? await listChannelMemberIds(db, id) : [];
  return toAdminChannel(row, memberIds);
}

channelRoutes.get('/', async (c) => {
  const channels = await listChannels(c.env.DB);
  const withMembers = await Promise.all(
    channels.map(async (row) => {
      const memberIds = row.audience === 'custom' ? await listChannelMemberIds(c.env.DB, row.id) : [];
      return toAdminChannel(row, memberIds);
    }),
  );
  return c.json({ channels: withMembers });
});

channelRoutes.get('/:id', async (c) => {
  const channel = await loadAdminChannel(c.env.DB, c.req.param('id'));
  if (!channel) throw notFound('频道不存在');
  return c.json({ channel });
});

channelRoutes.post('/', async (c) => {
  const body = await readJson<Record<string, unknown>>(c);
  const name = requireString(body.name, '频道名称', 40);
  const description = optionalString(body.description, '频道简介', 200);
  const audience = requireOneOf<ChannelAudience>(body.audience, CHANNEL_AUDIENCES, '受众');
  const postPolicy = requireOneOf<PostPolicy>(body.postPolicy, POST_POLICIES, '发言规则');
  const historyVisibility =
    body.historyVisibility === undefined ? DEFAULT_HISTORY_VISIBILITY : requireOneOf<HistoryVisibility>(body.historyVisibility, HISTORY_VISIBILITIES, '历史消息');
  const requestedMembers = memberIdList(body.memberIds);
  await requireExistingMembers(c.env.DB, requestedMembers);
  const memberIds =
    audience === 'custom'
      ? requestedMembers.length > 0
        ? requestedMembers
        : [c.get('member').id]
      : [];
  const channel = await createChannel(c.env.DB, {
    name,
    description,
    audience,
    postPolicy,
    historyVisibility,
    createdBy: c.get('member').id,
    memberIds,
  });
  if (audience === 'custom') c.executionCtx.waitUntil(announceJoins(c.env, channel.id, c.get('member'), memberIds));
  return c.json({ channel: await loadAdminChannel(c.env.DB, channel.id) }, 201);
});

channelRoutes.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const existing = await findChannel(c.env.DB, id);
  if (!existing) throw notFound('频道不存在');
  const actor = c.get('member');
  const body = await readJson<Record<string, unknown>>(c);
  const patch: ChannelPatch = {};
  if (body.name !== undefined) patch.name = requireString(body.name, '频道名称', 40);
  if (body.description !== undefined) patch.description = optionalString(body.description, '频道简介', 200);
  if (body.audience !== undefined) patch.audience = requireOneOf<ChannelAudience>(body.audience, CHANNEL_AUDIENCES, '受众');
  if (body.postPolicy !== undefined) patch.postPolicy = requireOneOf<PostPolicy>(body.postPolicy, POST_POLICIES, '发言规则');
  if (body.historyVisibility !== undefined) {
    // Only a real change is written; re-saving since_join must not restart the policy and grandfather recent joiners.
    // 只写入真正的变更；再次保存 since_join 不能重新开始策略，否则最近加入的人会被当作老成员。
    const historyVisibility = requireOneOf<HistoryVisibility>(body.historyVisibility, HISTORY_VISIBILITIES, '历史消息');
    if (historyVisibility !== (existing.history_visibility ?? DEFAULT_HISTORY_VISIBILITY)) patch.historyVisibility = historyVisibility;
  }
  // Validate everything before writing anything, so a bad member list does not leave a half-applied edit.
  // 写入前先校验全部字段，成员列表有误时不会只保存了一半。
  const requestedMembers = body.memberIds !== undefined ? memberIdList(body.memberIds) : null;
  if (requestedMembers) await requireExistingMembers(c.env.DB, requestedMembers);
  const nextAudience = patch.audience ?? existing.audience;
  const audienceChanged = nextAudience !== existing.audience;
  const membersBefore = audienceChanged && existing.audience === 'custom' ? await listChannelMemberIds(c.env.DB, id) : [];
  await updateChannel(c.env.DB, id, patch);

  // Membership rows are kept when a channel moves to another audience. They are inert there, and they
  // keep their join times if the channel becomes custom again.
  // 频道改为其他受众时保留成员记录。它们在那时不起作用；频道再改回指定成员时，加入时间保持不变。
  const roomId = channelRoomId(id);
  let membersAfter: string[] = [];
  if (nextAudience === 'custom' && (requestedMembers || patch.audience !== undefined)) {
    const listed = requestedMembers ?? (await listChannelMemberIds(c.env.DB, id));
    const memberIds = listed.length > 0 ? listed : [actor.id];
    const readerSince = existing.audience === 'custom' ? new Map<string, string>() : await previousReaders(c.env.DB, existing, memberIds);
    const diff = await replaceChannelMembers(c.env.DB, id, memberIds, { readerSince });
    const invited = diff.added.filter((memberId) => !readerSince.has(memberId));
    if (invited.length > 0) c.executionCtx.waitUntil(announceJoins(c.env, id, actor, invited));
    for (const removed of diff.removed) c.executionCtx.waitUntil(revokeRoom(c.env, roomId, removed));
    membersAfter = memberIds;
  }
  if (audienceChanged) {
    // Awaited before the room is revoked, so re-issued tickets already carry the new join times.
    // 在关闭房间连接之前等待完成，重新签发的票据就能用上新的加入时间。
    await recordAudienceChange(c.env.DB, existing, nextAudience, { before: new Set(membersBefore), after: new Set(membersAfter) });
  }
  if (patch.audience !== undefined || patch.postPolicy !== undefined || patch.historyVisibility !== undefined) {
    c.executionCtx.waitUntil(revokeRoom(c.env, roomId));
  }

  return c.json({ channel: await loadAdminChannel(c.env.DB, id) });
});

channelRoutes.post('/:id/members', async (c) => {
  const id = c.req.param('id');
  const channel = await findChannel(c.env.DB, id);
  if (!channel) throw notFound('频道不存在');
  const body = await readJson<Record<string, unknown>>(c);
  const memberIds = memberIdList(body.memberIds);
  await requireExistingMembers(c.env.DB, memberIds);
  const added = await addChannelMembers(c.env.DB, id, memberIds);
  if (channel.audience === 'custom' && added.length > 0) c.executionCtx.waitUntil(announceJoins(c.env, id, c.get('member'), added));
  return c.json({ ok: true });
});

channelRoutes.delete('/:id/members/:memberId', async (c) => {
  const id = c.req.param('id');
  const memberId = c.req.param('memberId');
  await removeChannelMember(c.env.DB, id, memberId);
  c.executionCtx.waitUntil(revokeRoom(c.env, channelRoomId(id), memberId));
  return c.json({ ok: true });
});

channelRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const channel = await findChannel(c.env.DB, id);
  if (!channel) throw notFound('频道不存在');
  await deleteChannel(c.env.DB, id);
  c.executionCtx.waitUntil(revokeRoom(c.env, channelRoomId(id)));
  // The uploaded icon goes with the channel; a preset is a bundled file and stays.
  // 上传的图标随频道一起删除；预设是内置文件，保留不动。
  if (channel.icon_key && isChannelIconUploadKey(channel.icon_key)) deleteIconLater(c, channel.icon_key);
  return c.json({ ok: true });
});

/* Channel icons */

/** Messages of the icon routes. The web app adds the English in shared/api/errors/channelIcons.ts. */
/** 图标接口的提示。网页端在 shared/api/errors/channelIcons.ts 中补上英文。 */
export const CHANNEL_ICON_MESSAGES = {
  type: '图标只支持 WebP 或 JPEG',
  size: '图标尺寸不对，请重新选择',
  tooLarge: '图标不能超过 256KB',
  preset: '没有这个预设图标',
  pending: '频道图标暂不可用',
  conflict: '图标刚被别人修改，请重试',
} as const;

/** The icon, its thumbnail and room for the multipart framing around them. */
/** 图标、缩略图以及它们外层 multipart 封装所需的余量。 */
export const CHANNEL_ICON_REQUEST_MAX_BYTES = CHANNEL_ICON_MAX_BYTES + CHANNEL_ICON_THUMB_MAX_BYTES + 16 * 1024;

const iconsPending = () => serviceUnavailable('schema_pending', CHANNEL_ICON_MESSAGES.pending);
const iconTooLarge = () => badRequest('too_large', CHANNEL_ICON_MESSAGES.tooLarge);

/**
 * Deletes an uploaded icon and its thumbnail after the response. The row no longer points at them, so a failure
 * only leaves files behind and is logged. Without a bucket nothing was ever stored.
 * 在响应之后删除上传的图标及其缩略图。记录已不再指向它们，失败只会留下文件，记录日志即可。没有存储桶时从未存过文件。
 */
function deleteIconLater(c: Context<AppEnv>, key: string): void {
  const bucket = c.env.FILES;
  if (!bucket) return;
  c.executionCtx.waitUntil(
    bucket.delete([key, channelIconThumbKey(key)]).catch((err: unknown) => {
      console.error(`channel icon: could not delete ${key}`, err instanceof Error ? err.message : String(err));
    }),
  );
}

/** The channel, or 404; 503 before migration 0018, checked before anything is read or stored. */
/** 返回频道，不存在时 404；迁移 0018 之前返回 503，在读取或存储任何内容之前检查。 */
async function requireIconChannel(db: D1Database, id: string): Promise<ChannelRow> {
  const channel = await findChannel(db, id);
  if (!channel) throw notFound('频道不存在');
  if (channel.icon_key === undefined) throw iconsPending();
  return channel;
}

interface IconUpload {
  type: ChannelIconType;
  icon: ArrayBuffer;
  thumb: ArrayBuffer;
}

function uploadedFile(value: unknown, field: string): Blob {
  if (!(value instanceof Blob)) throw badRequest('missing_field', `缺少 ${field}`);
  return value;
}

function isSquare(image: { width: number; height: number }, size: number): boolean {
  return image.width === size && image.height === size;
}

/**
 * The 256 px icon and its 96 px thumbnail from the multipart body: one allowed type for both, within the byte caps,
 * and bytes that really are that format at exactly that square size.
 * 从 multipart 请求体中读出 256px 图标及其 96px 缩略图：两者为同一种允许的类型，不超过字节上限，并且字节确实是该格式、恰好是该边长的正方形。
 */
async function readIconUpload(c: Context<AppEnv>): Promise<IconUpload> {
  let form: Record<string, unknown>;
  try {
    form = await c.req.parseBody();
  } catch {
    throw badRequest('invalid_body', '请求格式错误');
  }
  const icon = uploadedFile(form.icon, '图标');
  const thumb = uploadedFile(form.thumb, '缩略图');
  if (!isChannelIconType(icon.type) || thumb.type !== icon.type) throw badRequest('invalid_icon', CHANNEL_ICON_MESSAGES.type);
  const type = icon.type;
  if (icon.size === 0 || thumb.size === 0) throw badRequest('empty_file', '文件为空');
  if (icon.size > CHANNEL_ICON_MAX_BYTES || thumb.size > CHANNEL_ICON_THUMB_MAX_BYTES) throw iconTooLarge();
  const [iconBytes, thumbBytes] = await Promise.all([icon.arrayBuffer(), thumb.arrayBuffer()]);
  const iconImage = sniffImage(new Uint8Array(iconBytes));
  const thumbImage = sniffImage(new Uint8Array(thumbBytes));
  // The bytes decide, not the declared type: a canvas that cannot encode WebP silently returns PNG.
  // 以字节为准，而不是声明的类型：无法编码 WebP 的画布会悄悄返回 PNG。
  if (iconImage?.type !== type || thumbImage?.type !== type) throw badRequest('invalid_icon', CHANNEL_ICON_MESSAGES.type);
  if (!isSquare(iconImage, CHANNEL_ICON_SIZE) || !isSquare(thumbImage, CHANNEL_ICON_THUMB_SIZE)) {
    throw badRequest('invalid_icon', CHANNEL_ICON_MESSAGES.size);
  }
  return { type, icon: iconBytes, thumb: thumbBytes };
}

/**
 * Points the channel at `next` with a compare-and-swap against the key read with the channel, and returns the key
 * it replaced. When another admin changed the icon in between, the row is read again and the swap tried once more,
 * so the last writer wins and only the objects actually replaced are deleted; a second miss is 409 icon_conflict.
 * 以读取频道时得到的键做比较并交换，把频道指向 `next`，并返回被替换的键。若其间另一位管理员改了图标，就重新读取该行再试一次，
 * 因此最后写入的人生效，而且只删除确实被替换的对象；第二次仍不成功时返回 409 icon_conflict。
 */
async function swapIcon(db: D1Database, channel: ChannelRow, next: string | null): Promise<string | null> {
  try {
    const first = channel.icon_key ?? null;
    if (await setChannelIcon(db, channel.id, first, next)) return first;
    const fresh = await findChannel(db, channel.id);
    if (!fresh) throw notFound('频道不存在');
    const second = fresh.icon_key ?? null;
    if (await setChannelIcon(db, channel.id, second, next)) return second;
  } catch (err) {
    if (isMissingSchemaError(err)) throw iconsPending();
    throw err;
  }
  throw conflict('icon_conflict', CHANNEL_ICON_MESSAGES.conflict);
}

/** After a swap: deletes the upload it replaced (never a preset) and reads the channel back. */
/** 交换之后：删除被替换的上传图标（预设从不删除），再读回频道。 */
async function finishIconChange(c: Context<AppEnv>, id: string, previous: string | null, next: string | null): Promise<AdminChannelRow> {
  if (previous && previous !== next && isChannelIconUploadKey(previous)) deleteIconLater(c, previous);
  const channel = await loadAdminChannel(c.env.DB, id);
  if (!channel) throw notFound('频道不存在');
  return channel;
}

/**
 * Uploads a new icon: the client crops the image square and sends a 256 px icon and a 96 px thumbnail of one type.
 * Both are stored under a new random key before the row points at them, so a reader never meets a missing file.
 * 上传新图标：客户端把图片裁成正方形，发送同一类型的 256px 图标和 96px 缩略图。两者先以新的随机键存好，记录才指向它们，读取方因此不会遇到缺失的文件。
 */
channelRoutes.post('/:id/icon', memberRateLimit('channels:icon', 10, MINUTE), async (c) => {
  const id = c.req.param('id');
  const channel = await requireIconChannel(c.env.DB, id);
  const bucket = requireBucket(c.env);
  const declared = Number(c.req.header('content-length'));
  if (Number.isFinite(declared) && declared > CHANNEL_ICON_REQUEST_MAX_BYTES) throw iconTooLarge();
  const upload = await readIconUpload(c);
  const key = `${CHANNEL_ICON_KEY_PREFIX}${id}/${randomId('cic')}.${channelIconExtension(upload.type)}`;
  // Channel ids are randomId values or the seeded ch_ names, so this only fails for a row written by hand.
  // 频道 id 是 randomId 生成的值或预置的 ch_ 名称，只有手工写入的行才会不满足。
  if (!isChannelIconUploadKey(key)) throw new Error(`channel id ${id} cannot form an icon key`);
  // Every upload gets a new random key and is never overwritten, so a browser may keep it for a year.
  // 每次上传都使用新的随机键且从不覆盖，因此浏览器可以缓存一年。
  const options = { cacheControl: IMMUTABLE_MEDIA_CACHE };
  const stored = await Promise.allSettled([
    putObject(bucket, key, upload.icon, upload.type, options),
    putObject(bucket, channelIconThumbKey(key), upload.thumb, upload.type, options),
  ]);
  const failed = stored.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failed) {
    deleteIconLater(c, key);
    throw failed.reason;
  }
  let previous: string | null;
  try {
    previous = await swapIcon(c.env.DB, channel, key);
  } catch (err) {
    deleteIconLater(c, key);
    throw err;
  }
  const response: ChannelIconResponse = {
    channel: await finishIconChange(c, id, previous, key),
    mediaToken: await issueProfileMediaToken(c.env.SESSION_SECRET),
  };
  return c.json(response);
});

/** Switches to a bundled preset. Needs no storage, so it works before R2 is enabled. */
/** 改用内置预设。不需要存储，因此在开通 R2 之前也能使用。 */
channelRoutes.post('/:id/icon/preset', memberRateLimit('channels:icon', 10, MINUTE), async (c) => {
  const id = c.req.param('id');
  const channel = await requireIconChannel(c.env.DB, id);
  const body = await readJson<Record<string, unknown>>(c);
  const presetId = typeof body.id === 'string' ? body.id : '';
  if (!isChannelIconPresetId(presetId)) throw badRequest('invalid_icon_preset', CHANNEL_ICON_MESSAGES.preset);
  const key = channelIconPresetKey(presetId);
  const previous = await swapIcon(c.env.DB, channel, key);
  const response: ChannelIconResponse = { channel: await finishIconChange(c, id, previous, key) };
  return c.json(response);
});

/** Back to the text tile; an uploaded image is deleted. */
/** 恢复为文字头像；上传的图片会被删除。 */
channelRoutes.delete('/:id/icon', async (c) => {
  const id = c.req.param('id');
  const channel = await requireIconChannel(c.env.DB, id);
  const previous = await swapIcon(c.env.DB, channel, null);
  const response: ChannelIconResponse = { channel: await finishIconChange(c, id, previous, null) };
  return c.json(response);
});
