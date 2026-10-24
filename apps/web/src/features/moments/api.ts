import type {
  CreateMomentBody,
  CreateMomentCommentBody,
  CreateMomentCommentResponse,
  CreateMomentReportBody,
  CreateMomentResponse,
  MarkMomentFeedSeenBody,
  MarkMomentNoticesReadBody,
  ModerateMomentBody,
  MomentAlbumResponse,
  MomentAudienceCounts,
  MomentBadgeResponse,
  MomentBlocksResponse,
  MomentCommentsResponse,
  MomentFeedResponse,
  MomentLikeResponse,
  MomentNoticesResponse,
  MomentPostResponse,
  MomentRelation,
  MomentReportStatus,
  MomentReportsResponse,
  ResolveMomentReportBody,
  SetMomentLikeBody,
  UpdateMomentRelationBody,
} from '@utmmsc/shared';
import { api } from '../../shared/api/client';

const enc = encodeURIComponent;

/** `path` with the parameters that have a value; null, undefined and '' are left out. */
/** 带上有值参数的 `path`；null、undefined 和空字符串不加入。 */
function withQuery(path: string, params: Record<string, string | null | undefined>): string {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) if (value) query.set(name, value);
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}

function postPath(postId: string, rest = ''): string {
  return `/moments/posts/${enc(postId)}${rest}`;
}

/**
 * Every /moments call, through the shared api() client, so errors arrive as ApiClientError with the server's
 * Chinese message (errorMessage() adds the English). A cursor of null or undefined asks for page 1. There is no
 * PUT anywhere: likes and relations send the state wanted with POST and PATCH, which CORS allows.
 * 所有 /moments 接口调用，经由共用的 api() 客户端，错误以 ApiClientError 的形式带着服务器的中文提示到达（errorMessage() 补上英文）。
 * cursor 为 null 或 undefined 时请求第一页。这里没有任何 PUT：赞和权限设置用 POST 和 PATCH 发送想要的状态，CORS 允许这两种方法。
 */
export const momentsApi = {
  feed: (cursor?: string | null): Promise<MomentFeedResponse> => api<MomentFeedResponse>(withQuery('/moments/feed', { cursor })),
  /** 404 when the member is unknown or no longer active. */
  /** 成员不存在或已停用时返回 404。 */
  album: (memberId: string, cursor?: string | null): Promise<MomentAlbumResponse> =>
    api<MomentAlbumResponse>(withQuery(`/moments/members/${enc(memberId)}`, { cursor })),
  /** The post with up to MOMENT_DETAIL_COMMENTS comments; 404 moment_unavailable when it cannot be seen. */
  /** 动态及最多 MOMENT_DETAIL_COMMENTS 条评论；无法查看时返回 404 moment_unavailable。 */
  post: (postId: string): Promise<MomentPostResponse> => api<MomentPostResponse>(postPath(postId)),
  /** The next MOMENT_COMMENT_PAGE comments after `cursor` (the post's commentsCursor). */
  /** `cursor`（动态的 commentsCursor）之后的 MOMENT_COMMENT_PAGE 条评论。 */
  comments: (postId: string, cursor: string): Promise<MomentCommentsResponse> =>
    api<MomentCommentsResponse>(withQuery(postPath(postId, '/comments'), { cursor })),
  /** 201 for a new post, 200 with the first post when the clientId was already used. */
  /** 新动态返回 201；clientId 已用过时返回 200 和第一次的动态。 */
  create: (body: CreateMomentBody): Promise<CreateMomentResponse> => api<CreateMomentResponse>('/moments/posts', { method: 'POST', body }),
  remove: (postId: string): Promise<{ ok: true }> => api<{ ok: true }>(postPath(postId), { method: 'DELETE' }),
  /** Sends the state wanted, so repeating it is harmless and the latest call wins. */
  /** 发送想要的状态，重复发送没有副作用，以最后一次为准。 */
  like: (postId: string, body: SetMomentLikeBody): Promise<MomentLikeResponse> =>
    api<MomentLikeResponse>(postPath(postId, '/like'), { method: 'POST', body }),
  /** 201 for a new comment, 200 when the clientId was already used for the same comment, 409 for a different one. */
  /** 新评论返回 201；clientId 已用于同一条评论时返回 200，用于另一条时返回 409。 */
  comment: (postId: string, body: CreateMomentCommentBody): Promise<CreateMomentCommentResponse> =>
    api<CreateMomentCommentResponse>(postPath(postId, '/comments'), { method: 'POST', body }),
  removeComment: (commentId: string): Promise<{ ok: true }> => api<{ ok: true }>(`/moments/comments/${enc(commentId)}`, { method: 'DELETE' }),
  /** unreadOnly lists unread notices only (opened from the bubble). */
  /** unreadOnly 只列出未读的消息（从气泡打开时）。 */
  notices: (options: { cursor?: string | null; unreadOnly?: boolean } = {}): Promise<MomentNoticesResponse> =>
    api<MomentNoticesResponse>(withQuery('/moments/notices', { cursor: options.cursor, unread: options.unreadOnly ? '1' : null })),
  markNoticesRead: (body: MarkMomentNoticesReadBody): Promise<{ unread: number }> =>
    api<{ unread: number }>('/moments/notices/read', { method: 'POST', body }),
  /** Clear all. */
  /** 清空。 */
  clearNotices: (): Promise<{ ok: true }> => api<{ ok: true }>('/moments/notices', { method: 'DELETE' }),
  badge: (): Promise<MomentBadgeResponse> => api<MomentBadgeResponse>('/moments/badge'),
  /** The server keeps the later of upTo and what it has. */
  /** 服务器保留 upTo 与已存时间中较晚的一个。 */
  seen: (body: MarkMomentFeedSeenBody): Promise<{ ok: true }> => api<{ ok: true }>('/moments/seen', { method: 'POST', body }),
  /** 好友（N人）and 全社团（N人）in the 谁可以看 sheet. */
  /** 「谁可以看」中的「好友（N人）」和「全社团（N人）」。 */
  audience: (): Promise<MomentAudienceCounts> => api<MomentAudienceCounts>('/moments/audience'),
  blocks: (): Promise<MomentBlocksResponse> => api<MomentBlocksResponse>('/moments/blocks'),
  relation: (memberId: string): Promise<MomentRelation> => api<MomentRelation>(`/moments/blocks/${enc(memberId)}`),
  updateRelation: (memberId: string, body: UpdateMomentRelationBody): Promise<MomentRelation> =>
    api<MomentRelation>(`/moments/blocks/${enc(memberId)}`, { method: 'PATCH', body }),
  /** A second report of the same item also answers ok. */
  /** 重复投诉同一内容也返回 ok。 */
  report: (body: CreateMomentReportBody): Promise<{ ok: true }> => api<{ ok: true }>('/moments/reports', { method: 'POST', body }),
  reports: (options: { status: MomentReportStatus; cursor?: string | null }): Promise<MomentReportsResponse> =>
    api<MomentReportsResponse>(withQuery('/moments/moderation/reports', { status: options.status, cursor: options.cursor })),
  /** Resolves every open report on the same post or comment. */
  /** 同时处理针对同一动态或评论的所有未处理投诉。 */
  resolveReport: (reportId: string, body: ResolveMomentReportBody): Promise<{ ok: true }> =>
    api<{ ok: true }>(`/moments/moderation/reports/${enc(reportId)}/resolve`, { method: 'POST', body }),
  moderatePost: (postId: string, body: ModerateMomentBody): Promise<{ ok: true }> =>
    api<{ ok: true }>(`/moments/moderation/posts/${enc(postId)}/remove`, { method: 'POST', body }),
  restorePost: (postId: string): Promise<{ ok: true }> => api<{ ok: true }>(`/moments/moderation/posts/${enc(postId)}/restore`, { method: 'POST' }),
  moderateComment: (commentId: string, body: ModerateMomentBody): Promise<{ ok: true }> =>
    api<{ ok: true }>(`/moments/moderation/comments/${enc(commentId)}/remove`, { method: 'POST', body }),
  restoreComment: (commentId: string): Promise<{ ok: true }> =>
    api<{ ok: true }>(`/moments/moderation/comments/${enc(commentId)}/restore`, { method: 'POST' }),
};

export type MomentsApi = typeof momentsApi;
