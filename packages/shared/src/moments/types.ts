/** Limits and shapes of 好友动态, shared by the feed screens and the API. */
/** 好友动态的限制与数据结构，供动态页面与接口共用。 */
import type { PostMedia } from '../identity/profile';

/**
 * friends: the author's accepted friends. club: every active member. private: the author alone.
 * friends：作者已通过的好友。club：全体在用成员。private：仅作者本人。
 */
export const MOMENT_AUDIENCES = ['friends', 'club', 'private'] as const;
export type MomentAudience = (typeof MOMENT_AUDIENCES)[number];

/** Code points in a post. The legacy POST_MAX of 500 still applies to /members/me/posts. */
/** 一条动态的字数上限（按码点计）。旧接口 /members/me/posts 仍使用 POST_MAX 500。 */
export const MOMENT_TEXT_MAX = 2000;
/** Code points in a comment. */
/** 一条评论的字数上限（按码点计）。 */
export const MOMENT_COMMENT_MAX = 300;
/** Posts per page of the home feed and of an album. */
/** 动态首页和相册每页的动态数。 */
export const MOMENT_PAGE_SIZE = 10;
/** Comments a feed card carries before 展开其余 N 条评论. */
/** 信息流卡片在「展开其余 N 条评论」之前附带的评论数。 */
export const MOMENT_INLINE_COMMENTS = 20;
/** Comments per page of GET /moments/posts/:id/comments. */
/** GET /moments/posts/:id/comments 每页的评论数。 */
export const MOMENT_COMMENT_PAGE = 50;
/** Comments the detail page receives with the post. */
/** 详情页随动态一起收到的评论数。 */
export const MOMENT_DETAIL_COMMENTS = 200;
/** Liker names a post carries; beyond this the card shows 等 N 人. */
/** 一条动态附带的点赞人数；超出时卡片显示「等 N 人」。 */
export const MOMENT_INLINE_LIKES = 100;
/** Notices per page of 消息. */
/** 「消息」每页的条数。 */
export const MOMENT_NOTICE_PAGE = 30;
/** Long edge of the JPEG preview of a photo or of a video's first frame. */
/** 照片预览图或视频首帧 JPEG 的长边像素。 */
export const MOMENT_PREVIEW_LONG_EDGE = 720;
/** Largest width or height a media item may claim. */
/** 媒体可声明的最大宽度或高度。 */
export const MOMENT_MEDIA_DIMENSION_MAX = 20000;
export const MOMENT_VIDEO_DURATION_MAX_MS = 10 * 60 * 1000;
/** Earlier likers and commenters told about a new comment, most recent first. */
/** 新评论最多通知的此前点赞和评论的人数，按最近优先。 */
export const MOMENT_THREAD_RECIPIENTS_MAX = 50;

export const MOMENT_REPORT_REASONS = ['spam', 'harassment', 'inappropriate', 'privacy', 'other'] as const;
export type MomentReportReason = (typeof MOMENT_REPORT_REASONS)[number];
export const MOMENT_REPORT_NOTE_MAX = 200;
export const MOMENT_MODERATION_REASON_MAX = 200;

/**
 * like: liked your post. comment: commented on your post. reply: answered you. thread: someone you can see
 * commented on a post you liked or commented on (in-app only). removed: a moderator removed your post or comment.
 * like：赞了你的动态。comment：评论了你的动态。reply：回复了你。thread：你能看到的人评论了你赞过或评论过的动态（只在应用内显示）。
 * removed：管理员移除了你的动态或评论。
 */
export const MOMENT_NOTICE_KINDS = ['like', 'comment', 'reply', 'thread', 'removed'] as const;
export type MomentNoticeKind = (typeof MOMENT_NOTICE_KINDS)[number];

export interface MomentPerson {
  id: string;
  displayName: string;
  avatarKey: string | null;
}

export interface MomentMedia extends PostMedia {
  /** Null for media posted before sizes were recorded. */
  /** 记录尺寸之前发布的媒体为 null。 */
  width: number | null;
  height: number | null;
  previewKey: string | null;
  durationMs: number | null;
}

/** When a moderator removed something, and why. Only its author receives it. */
/** 管理员移除内容的时间和原因。只发给内容的作者。 */
export interface MomentRemoval {
  at: string;
  reason: string | null;
}

export interface MomentComment {
  id: string;
  postId: string;
  author: MomentPerson;
  /** Null for a plain comment, or when the member answered is no longer active. */
  /** 普通评论为 null；被回复的成员已停用时也为 null。 */
  replyTo: MomentPerson | null;
  replyToCommentId: string | null;
  body: string;
  createdAt: string;
  /** The comment's author or the post's author. */
  /** 评论作者或动态作者。 */
  canDelete: boolean;
  /** A moderator who outranks the comment's author. */
  /** 职位高于评论作者的管理员。 */
  canModerate: boolean;
  /** Only to the comment's author. */
  /** 只发给评论作者。 */
  clientId?: string;
  /** Only to the comment's author. */
  /** 只发给评论作者。 */
  removed?: MomentRemoval;
}

export interface MomentPost {
  id: string;
  author: MomentPerson;
  body: string;
  media: MomentMedia[];
  location: string | null;
  createdAt: string;
  /** Everyone who can see the post sees every like and comment on it. */
  /** 能看到这条动态的人都能看到它的全部赞和评论。 */
  clubWide: boolean;
  /** Only to the author. */
  /** 只发给作者。 */
  audience?: MomentAudience;
  /** Visible likers, oldest first, at most MOMENT_INLINE_LIKES. */
  /** 可见的点赞人，最早的在前，最多 MOMENT_INLINE_LIKES 个。 */
  likes: MomentPerson[];
  /** Likes this viewer can see. */
  /** 这位查看者能看到的赞数。 */
  likeCount: number;
  likedByMe: boolean;
  /** Visible comments, oldest first, at most MOMENT_INLINE_COMMENTS (detail: MOMENT_DETAIL_COMMENTS). */
  /** 可见的评论，最早的在前，最多 MOMENT_INLINE_COMMENTS 条（详情页为 MOMENT_DETAIL_COMMENTS 条）。 */
  comments: MomentComment[];
  /** Comments this viewer can see. */
  /** 这位查看者能看到的评论数。 */
  commentCount: number;
  /** Continues the comments after the last one included; null when all are included. */
  /** 从已附带的最后一条之后继续加载评论；已全部附带时为 null。 */
  commentsCursor: string | null;
  canDelete: boolean;
  canModerate: boolean;
  canReport: boolean;
  canInteract: boolean;
  /** Only to the author. */
  /** 只发给作者。 */
  clientId?: string;
  /** Only to the author. */
  /** 只发给作者。 */
  removed?: MomentRemoval;
}

export interface MomentMediaInput {
  key: string;
  contentType: string;
  width?: number;
  height?: number;
  previewKey?: string;
  durationMs?: number;
}

export interface CreateMomentBody {
  clientId: string;
  text?: string;
  media?: MomentMediaInput[];
  audience: MomentAudience;
  location?: string | null;
}

export interface CreateMomentCommentBody {
  clientId: string;
  text: string;
  replyToCommentId?: string | null;
}

/** The state the member wants, so the latest tap wins. */
/** 成员想要的状态，因此以最后一次点击为准。 */
export interface SetMomentLikeBody {
  liked: boolean;
}

export interface MomentFeedResponse {
  posts: MomentPost[];
  nextCursor: string | null;
  mediaToken: string;
}

export interface MomentAlbumOwner extends MomentPerson {
  coverKey: string | null;
  headline: string | null;
}

export interface MomentAlbumResponse {
  member: MomentAlbumOwner;
  posts: MomentPost[];
  nextCursor: string | null;
  mediaToken: string;
  /** The viewer is neither the owner nor a friend, so only club posts can appear. */
  /** 查看者既不是本人也不是好友，因此只会出现全社团可见的动态。 */
  clubOnly: boolean;
}

export interface MomentPostResponse {
  post: MomentPost;
  mediaToken: string;
}

export interface MomentCommentsResponse {
  comments: MomentComment[];
  nextCursor: string | null;
}

export interface CreateMomentResponse {
  post: MomentPost;
  mediaToken: string;
}

export interface MomentLikeResponse {
  likedByMe: boolean;
  likes: MomentPerson[];
  likeCount: number;
}

export interface CreateMomentCommentResponse {
  comment: MomentComment;
  commentCount: number;
}

export interface MomentNotice {
  id: string;
  kind: MomentNoticeKind;
  createdAt: string;
  read: boolean;
  /** Null for removed, shown as 管理员. */
  /** removed 为 null，显示为「管理员」。 */
  actor: MomentPerson | null;
  post: {
    id: string;
    excerpt: string;
    /** key is always an image; it is null for a video posted before its first frame was kept. */
    /** key 总是一张图片；在保存首帧之前发的视频没有预览图，key 为 null。 */
    preview: { key: string | null; kind: 'image' | 'video' } | null;
    /** False when the reader can no longer see the post. */
    /** 读者已无法查看这条动态时为 false。 */
    available: boolean;
    /** Every member can read the post and its comments, so a reply from the notice says so; false when unavailable. */
    /** 全体成员都能看到这条动态及其评论，从消息里回复时会提示这一点；无法查看时为 false。 */
    clubWide: boolean;
  };
  /** body is null when the comment was deleted or removed. */
  /** 评论已删除或已被移除时 body 为 null。 */
  comment: { id: string; body: string | null; replyTo: MomentPerson | null } | null;
}

export interface MomentNoticesResponse {
  notices: MomentNotice[];
  nextCursor: string | null;
  unread: number;
  mediaToken: string;
}

/** Marks every notice created at or before upTo as read. */
/** 把 upTo 及之前创建的通知全部标为已读。 */
export interface MarkMomentNoticesReadBody {
  upTo: string;
}

export interface MomentBadgeResponse {
  unread: number;
  latestActor: MomentPerson | null;
  newPosts: number;
  latestAuthor: MomentPerson | null;
}

/** The newest post time seen on the home feed; the server keeps the later of this and what it has. */
/** 在动态首页看到的最新动态时间；服务器保留它与已存时间中较晚的一个。 */
export interface MarkMomentFeedSeenBody {
  upTo: string;
}

export interface MomentAudienceCounts {
  friends: number;
  club: number;
}

/**
 * hideFrom: 不让TA看, my updates are hidden from them. mute: 不看TA, my home feed skips theirs.
 * hideFrom：不让TA看，我的动态不给对方看。mute：不看TA，我的动态首页不显示对方的动态。
 */
export interface MomentRelation {
  hideFrom: boolean;
  mute: boolean;
}

export type UpdateMomentRelationBody = Partial<MomentRelation>;

export interface MomentBlocksResponse {
  hideFrom: MomentPerson[];
  muted: MomentPerson[];
}

export interface CreateMomentReportBody {
  postId: string;
  commentId?: string | null;
  reason: MomentReportReason;
  note?: string | null;
}

export const MOMENT_REPORT_STATUSES = ['open', 'removed', 'dismissed'] as const;
export type MomentReportStatus = (typeof MOMENT_REPORT_STATUSES)[number];

export interface MomentReport {
  id: string;
  reason: MomentReportReason;
  note: string | null;
  createdAt: string;
  status: MomentReportStatus;
  reporter: MomentPerson;
  target: MomentPerson;
  /** Open reports on the same post or comment. */
  /** 针对同一动态或评论的未处理投诉数。 */
  reportCount: number;
  postId: string;
  commentId: string | null;
  /** The content as it was when reported. */
  /** 投诉时内容的原样。 */
  snapshot: { body: string; media: MomentMedia[] };
  current: 'live' | 'removed' | 'deleted';
  /** False when the moderator does not outrank the target. */
  /** 管理员职位不高于被投诉人时为 false。 */
  canResolve: boolean;
}

export interface MomentReportsResponse {
  reports: MomentReport[];
  nextCursor: string | null;
  mediaToken: string;
}

export interface ResolveMomentReportBody {
  action: 'remove' | 'dismiss';
  reason?: string;
}

export interface ModerateMomentBody {
  reason: string;
}
