import {
  isMomentClientId,
  LOCATION_MAX,
  MOMENT_AUDIENCES,
  MOMENT_COMMENT_MAX,
  MOMENT_MEDIA_DIMENSION_MAX,
  MOMENT_MODERATION_REASON_MAX,
  MOMENT_REPORT_NOTE_MAX,
  MOMENT_REPORT_REASONS,
  MOMENT_TEXT_MAX,
  MOMENT_VIDEO_DURATION_MAX_MS,
  momentTextLength,
  normalizeMomentComment,
  normalizeMomentText,
  type MomentAudience,
  type MomentMedia,
  type MomentReportReason,
  type PostMedia,
  type UpdateMomentRelationBody,
} from '@utmmsc/shared';
import { FieldError } from '../profile/fields';
import { normalizePostMedia, ownsMomentKey } from '../profile/media';

/**
 * What each refusal says. The route sends the code and the Chinese text as they are, and the web app adds
 * the English for each text in shared/api/errors.ts. invalid_media also carries the messages of the existing
 * normalizePostMedia (照片和视频不能发在同一条里, 最多 9 张照片 and the rest).
 * 每种拒绝的提示文字。接口原样返回错误码和中文，网页端在 shared/api/errors.ts 中为每句中文补上英文。
 * invalid_media 还会带上现有 normalizePostMedia 的提示（照片和视频不能发在同一条里、最多 9 张照片等）。
 */
export const MOMENT_INPUT_MESSAGES = {
  invalid_client_id: '请求格式错误',
  /** A field of the wrong type, such as a number for text; the same text as readJson's invalid_json. */
  /** 字段类型不对，例如正文是数字；提示文字与 readJson 的 invalid_json 相同。 */
  invalid_body: '请求格式错误',
  empty_post: '写点什么，或加上照片、视频',
  text_too_long: `正文不能超过 ${MOMENT_TEXT_MAX} 字`,
  empty_comment: '评论不能为空',
  comment_too_long: `评论不能超过 ${MOMENT_COMMENT_MAX} 字`,
  invalid_audience: '请选择谁可以看',
  location_too_long: `位置不能超过 ${LOCATION_MAX} 字`,
  invalid_media: '照片或视频的格式不对',
  invalid_media_size: '照片或视频的尺寸不对',
  invalid_preview: '预览图无法使用，请重新选择',
  invalid_like: '请求格式错误',
  invalid_relation: '请选择要修改的设置',
  invalid_report_reason: '请选择投诉原因',
  report_note_too_long: `补充说明不能超过 ${MOMENT_REPORT_NOTE_MAX} 字`,
  missing_moderation_reason: '请填写移除原因',
  moderation_reason_too_long: `原因不能超过 ${MOMENT_MODERATION_REASON_MAX} 字`,
  invalid_resolve_action: '请选择处理方式',
  invalid_time: '时间格式错误',
} as const;

export type MomentInputErrorCode = keyof typeof MOMENT_INPUT_MESSAGES;

/**
 * A refused request body. Domain code does not know HTTP, so routes turn this into
 * badRequest(error.code, error.message).
 * 被拒绝的请求体。领域代码不涉及 HTTP，接口把它转换成 badRequest(error.code, error.message)。
 */
export class MomentInputError extends Error {
  constructor(
    public readonly code: MomentInputErrorCode,
    message: string = MOMENT_INPUT_MESSAGES[code],
  ) {
    super(message);
  }
}

/** A post ready to store. text is normalized and may be empty when there is media. */
/** 可以保存的动态。text 已规范化；有媒体时可以为空。 */
export interface CreateMomentInput {
  clientId: string;
  text: string;
  media: MomentMedia[];
  audience: MomentAudience;
  location: string | null;
}

export interface CreateMomentCommentInput {
  clientId: string;
  /** Normalized, 1 to MOMENT_COMMENT_MAX code points. */
  /** 已规范化，1 到 MOMENT_COMMENT_MAX 个码点。 */
  text: string;
  replyToCommentId: string | null;
}

export interface MomentReportInput {
  postId: string;
  commentId: string | null;
  reason: MomentReportReason;
  note: string | null;
}

export interface ResolveMomentReportInput {
  action: 'remove' | 'dismiss';
  /** Required to remove, ignored to dismiss. */
  /** 移除时必填，驳回时忽略。 */
  reason: string | null;
}

/** Longest id a body may name for a post or a comment; stored ids are far shorter. */
/** 请求体中动态或评论 id 的最大长度；已保存的 id 远比这短。 */
const ROW_ID_MAX = 100;

function absent(value: unknown): boolean {
  return value === undefined || value === null;
}

function readClientId(value: unknown): string {
  if (!isMomentClientId(value)) throw new MomentInputError('invalid_client_id');
  return value;
}

/** An optional string field: absent means '', anything but a string is malformed. */
/** 可选的字符串字段：缺失为 ''，不是字符串则格式错误。 */
function optionalText(value: unknown): string {
  if (absent(value)) return '';
  if (typeof value !== 'string') throw new MomentInputError('invalid_body');
  return value;
}

function readRowId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > ROW_ID_MAX) throw new MomentInputError('invalid_body');
  return value;
}

function optionalRowId(value: unknown): string | null {
  return absent(value) ? null : readRowId(value);
}

/**
 * POST /moments/posts. clientId must pass isMomentClientId, text goes through normalizeMomentText and is at
 * most MOMENT_TEXT_MAX code points, audience must be one of MOMENT_AUDIENCES, location goes through
 * readMomentLocation and media through normalizeMomentMedia. Text or media is required (empty_post).
 * POST /moments/posts。clientId 须通过 isMomentClientId；text 经 normalizeMomentText 处理，最多 MOMENT_TEXT_MAX 个码点；
 * audience 须在 MOMENT_AUDIENCES 中；location 经 readMomentLocation 处理；media 经 normalizeMomentMedia 处理。正文和媒体至少要有一项（empty_post）。
 */
export function readCreateMoment(memberId: string, body: Record<string, unknown>): CreateMomentInput {
  const clientId = readClientId(body.clientId);
  const text = normalizeMomentText(optionalText(body.text));
  if (momentTextLength(text) > MOMENT_TEXT_MAX) throw new MomentInputError('text_too_long');
  const audience = readMomentAudience(body.audience);
  const location = readMomentLocation(body.location);
  const media = normalizeMomentMedia(memberId, body.media);
  if (!text && media.length === 0) throw new MomentInputError('empty_post');
  return { clientId, text, media, audience, location };
}

/** A whole number from min to max, or undefined when the field is absent. */
/** min 到 max 之间的整数；字段缺失时为 undefined。 */
function boundedInteger(value: unknown, min: number, max: number): number | undefined {
  if (absent(value)) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new MomentInputError('invalid_media_size');
  return value;
}

/**
 * The existing normalizePostMedia (own moments/<memberId>/ keys, nine photos or one video, never mixed), then
 * width and height as integers 1..MOMENT_MEDIA_DIMENSION_MAX, durationMs 0..MOMENT_VIDEO_DURATION_MAX_MS on a
 * video only, and previewKey passing ownsMomentKey(memberId, key, 'image/jpeg'). Missing sizes become null.
 * Width and height come together or not at all, since a box needs both.
 * 先经现有的 normalizePostMedia（只能用自己 moments/<memberId>/ 下的键，九张照片或一个视频，不能混发），
 * 再要求 width 和 height 为 1..MOMENT_MEDIA_DIMENSION_MAX 的整数，durationMs 仅视频可有且为 0..MOMENT_VIDEO_DURATION_MAX_MS，
 * previewKey 须通过 ownsMomentKey(memberId, key, 'image/jpeg')。未提供的尺寸为 null。宽和高必须同时提供或同时省略，预留大小需要两者。
 */
export function normalizeMomentMedia(memberId: string, value: unknown): MomentMedia[] {
  let base: PostMedia[];
  try {
    base = normalizePostMedia(memberId, value);
  } catch (error) {
    if (error instanceof FieldError) throw new MomentInputError('invalid_media', error.message);
    throw error;
  }
  const raw = (value ?? []) as Record<string, unknown>[];
  return base.map((item, index) => {
    const source = raw[index] ?? {};
    const width = boundedInteger(source.width, 1, MOMENT_MEDIA_DIMENSION_MAX);
    const height = boundedInteger(source.height, 1, MOMENT_MEDIA_DIMENSION_MAX);
    if ((width === undefined) !== (height === undefined)) throw new MomentInputError('invalid_media_size');
    const durationMs = boundedInteger(source.durationMs, 0, MOMENT_VIDEO_DURATION_MAX_MS);
    if (durationMs !== undefined && item.kind !== 'video') throw new MomentInputError('invalid_media_size');
    let previewKey: string | null = null;
    if (!absent(source.previewKey)) {
      if (typeof source.previewKey !== 'string' || !ownsMomentKey(memberId, source.previewKey, 'image/jpeg')) {
        throw new MomentInputError('invalid_preview');
      }
      previewKey = source.previewKey;
    }
    return { ...item, width: width ?? null, height: height ?? null, previewKey, durationMs: durationMs ?? null };
  });
}

/**
 * One line, trimmed, at most LOCATION_MAX characters (code points); missing or empty means null.
 * 单行，去掉首尾空白，最多 LOCATION_MAX 个字（按码点计）；缺失或为空时为 null。
 */
export function readMomentLocation(value: unknown): string | null {
  const location = normalizeMomentComment(optionalText(value));
  if (!location) return null;
  if (momentTextLength(location) > LOCATION_MAX) throw new MomentInputError('location_too_long');
  return location;
}

export function readMomentAudience(value: unknown): MomentAudience {
  if (typeof value !== 'string' || !(MOMENT_AUDIENCES as readonly string[]).includes(value)) throw new MomentInputError('invalid_audience');
  return value as MomentAudience;
}

/**
 * POST /moments/posts/:id/comments. text goes through normalizeMomentComment and must be 1..MOMENT_COMMENT_MAX
 * code points; replyToCommentId is a string or null. The member answered is never read from the client.
 * POST /moments/posts/:id/comments。text 经 normalizeMomentComment 处理，须为 1..MOMENT_COMMENT_MAX 个码点；
 * replyToCommentId 为字符串或 null。被回复的成员从不取自客户端。
 */
export function readMomentComment(body: Record<string, unknown>): CreateMomentCommentInput {
  const clientId = readClientId(body.clientId);
  const text = normalizeMomentComment(optionalText(body.text));
  if (!text) throw new MomentInputError('empty_comment');
  if (momentTextLength(text) > MOMENT_COMMENT_MAX) throw new MomentInputError('comment_too_long');
  return { clientId, text, replyToCommentId: optionalRowId(body.replyToCommentId) };
}

/** POST /moments/posts/:id/like: the boolean liked. */
/** POST /moments/posts/:id/like：布尔值 liked。 */
export function readMomentLike(body: Record<string, unknown>): boolean {
  if (typeof body.liked !== 'boolean') throw new MomentInputError('invalid_like');
  return body.liked;
}

/** PATCH /moments/blocks/:memberId: hideFrom and mute are booleans when present, and at least one is. */
/** PATCH /moments/blocks/:memberId：hideFrom 和 mute 出现时须为布尔值，且至少出现一个。 */
export function readMomentRelationPatch(body: Record<string, unknown>): UpdateMomentRelationBody {
  const patch: UpdateMomentRelationBody = {};
  for (const field of ['hideFrom', 'mute'] as const) {
    const value = body[field];
    if (value === undefined) continue;
    if (typeof value !== 'boolean') throw new MomentInputError('invalid_relation');
    patch[field] = value;
  }
  if (patch.hideFrom === undefined && patch.mute === undefined) throw new MomentInputError('invalid_relation');
  return patch;
}

/** POST /moments/reports: reason in MOMENT_REPORT_REASONS, note trimmed to null or at most MOMENT_REPORT_NOTE_MAX. */
/** POST /moments/reports：reason 须在 MOMENT_REPORT_REASONS 中；note 去空白后为 null 或最多 MOMENT_REPORT_NOTE_MAX 个字。 */
export function readMomentReport(body: Record<string, unknown>): MomentReportInput {
  const postId = readRowId(body.postId);
  const commentId = optionalRowId(body.commentId);
  const reason = body.reason;
  if (typeof reason !== 'string' || !(MOMENT_REPORT_REASONS as readonly string[]).includes(reason)) {
    throw new MomentInputError('invalid_report_reason');
  }
  const note = normalizeMomentText(optionalText(body.note));
  if (momentTextLength(note) > MOMENT_REPORT_NOTE_MAX) throw new MomentInputError('report_note_too_long');
  return { postId, commentId, reason: reason as MomentReportReason, note: note || null };
}

/**
 * The reason of a moderator's removal: one line, trimmed, 1..MOMENT_MODERATION_REASON_MAX. The author reads
 * it inline after 这条动态已被管理员移除：.
 * 管理员移除的原因：单行，去掉首尾空白，1..MOMENT_MODERATION_REASON_MAX 个字。作者会在「这条动态已被管理员移除：」之后看到它。
 */
export function readModerationReason(body: Record<string, unknown>): string {
  const reason = normalizeMomentComment(optionalText(body.reason));
  if (!reason) throw new MomentInputError('missing_moderation_reason');
  if (momentTextLength(reason) > MOMENT_MODERATION_REASON_MAX) throw new MomentInputError('moderation_reason_too_long');
  return reason;
}

/** POST /moments/moderation/reports/:id/resolve. */
/** POST /moments/moderation/reports/:id/resolve。 */
export function readResolveReport(body: Record<string, unknown>): ResolveMomentReportInput {
  if (body.action === 'remove') return { action: 'remove', reason: readModerationReason(body) };
  if (body.action === 'dismiss') return { action: 'dismiss', reason: null };
  throw new MomentInputError('invalid_resolve_action');
}

/** An ISO 8601 instant with a time zone, as toISOString and Date.toJSON write it. */
/** 带时区的 ISO 8601 时间，与 toISOString 和 Date.toJSON 的写法一致。 */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

/** upTo of POST /moments/notices/read and POST /moments/seen: a valid ISO instant, returned in toISOString form. */
/** POST /moments/notices/read 和 POST /moments/seen 的 upTo：有效的 ISO 时间，以 toISOString 的形式返回。 */
export function readUpTo(body: Record<string, unknown>): string {
  const value = body.upTo;
  if (typeof value !== 'string' || !ISO_INSTANT.test(value)) throw new MomentInputError('invalid_time');
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new MomentInputError('invalid_time');
  return new Date(ms).toISOString();
}
