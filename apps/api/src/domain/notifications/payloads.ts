import { NOTIFICATION_TIME_ZONE, formatEventTimeZh, wallClockAt, type EventNotificationKind, type PushPayload } from '@utmmsc/shared';
import { previewOf } from '../messaging/preview';

/**
 * Notification copy. Devices render it as sent and the server knows no member's language, so it is in
 * Chinese, the app's default language, and kept short.
 * 通知文案。设备按原样显示，而服务器不知道成员使用的语言，因此使用应用的默认语言中文，并保持简短。
 */
export const PUSH_COPY = {
  appName: 'UTMMSC',
  hiddenMessage: '你收到一条新消息',
  mentionPrefix: '[有人@我] ',
  image: '[图片]',
  sticker: '[表情]',
  eventPublished: '活动：',
  eventToday: '今天的活动：',
  eventTomorrow: '明天的活动：',
  eventReminder: '活动提醒：',
  testBody: '通知已开启，这是一条测试通知',
  recalled: '撤回了一条消息',
  peerRecalled: '对方撤回了一条消息',
  deleted: '一条消息已被删除',
  moderatorDeleted: '管理员删除了一条消息',
  momentTitle: '好友动态',
  momentHidden: '好友动态有新互动',
  momentSomeone: '有人',
  momentCommented: '评论了你',
  momentReplied: '回复了你',
  momentPostRemoved: '你的一条动态已被管理员移除',
  momentCommentRemoved: '你的一条评论已被管理员移除',
  momentCommentDeleted: '一条评论已删除',
} as const;

const TITLE_MAX = 60;
const BODY_MAX = 160;

/**
 * Cuts at max code units with an ellipsis, never between the two halves of a surrogate pair, which would
 * leave a broken character such as half an emoji.
 * 超过 max 个代码单元时截断并加省略号；不会从代理对中间截断，否则会留下半个表情符号之类的坏字符。
 */
function capped(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = max - 1;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return `${text.slice(0, end)}…`;
}

/** In-app path of a room, as an absolute URL under the member app. */
/** 房间在应用内的路径，以成员应用下的绝对地址表示。 */
export function roomUrl(baseUrl: string, roomId: string): string {
  return `${withSlash(baseUrl)}chat/room/${encodeURIComponent(roomId)}`;
}

function withSlash(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
}

export interface MessagePushInput {
  roomId: string;
  roomKind: 'channel' | 'direct';
  /** Channel name; unused for direct messages, whose title is the sender. */
  /** 频道名称；私聊不使用，私聊的标题为发送人。 */
  roomTitle: string;
  authorName: string;
  text: string;
  hasImage: boolean;
  /** The message is a sticker; its content then reads [表情]. */
  /** 消息是表情；内容显示为 [表情]。 */
  hasSticker?: boolean;
  /** Named in the message or covered by @所有人. */
  /** 消息中 @ 了此人，或使用了 @所有人。 */
  mentioned: boolean;
  /** The recipient's preview switch. */
  /** 收件人的「显示消息内容」开关。 */
  preview: boolean;
  baseUrl: string;
  /** The channel's icon as an absolute https URL (icon.ts channelIconPushUrl); the device shows the app icon without it. */
  /** 频道图标的 https 绝对地址（见 icon.ts 的 channelIconPushUrl）；没有时设备显示 App 图标。 */
  icon?: string;
}

/**
 * WeChat style: a channel shows its name over "sender: text", a direct message shows the sender over
 * the text. The room id is the tag, so a newer push for the same chat replaces the older one. The channel
 * icon goes only with the preview: the hidden notice names no chat, and an icon would.
 * 与微信一致：频道以频道名为标题、「发送人: 内容」为正文；私聊以发送人为标题、内容为正文。房间 id 作为 tag，同一聊天较新的推送会替换较旧的一条。
 * 频道图标只随显示内容的通知一起发送：隐藏内容的通知不透露是哪个聊天，而图标会透露。
 */
export function messagePushPayload(input: MessagePushInput): PushPayload {
  const base = { tag: input.roomId, url: roomUrl(input.baseUrl, input.roomId), kind: 'message' as const, roomId: input.roomId };
  if (!input.preview) return { ...base, title: PUSH_COPY.appName, body: PUSH_COPY.hiddenMessage };
  const content = input.hasSticker ? PUSH_COPY.sticker : previewOf(input.text, input.hasImage) || PUSH_COPY.image;
  const author = input.authorName.trim() || PUSH_COPY.appName;
  if (input.roomKind === 'direct') {
    return { ...base, title: capped(author, TITLE_MAX), body: capped(content, BODY_MAX) };
  }
  const line = `${input.mentioned ? PUSH_COPY.mentionPrefix : ''}${author}: ${content}`;
  return {
    ...base,
    title: capped(input.roomTitle.trim() || PUSH_COPY.appName, TITLE_MAX),
    body: capped(line, BODY_MAX),
    ...(input.icon ? { icon: input.icon } : {}),
  };
}

/** How a message left: recalled by its author, deleted by its author, or removed by a moderator. */
/** 消息是如何消失的：作者撤回、作者删除，或管理员删除。 */
export type Retraction = 'recalled' | 'deleted' | 'removed';

export interface RetractionPushInput {
  roomId: string;
  roomKind: 'channel' | 'direct';
  roomTitle: string;
  authorName: string;
  reason: Retraction;
  baseUrl: string;
  /** The channel's icon, so the replacement looks like the notice it replaces. */
  /** 频道图标，使替换后的通知与原通知外观一致。 */
  icon?: string;
}

/**
 * Takes the place of a withdrawn message's notice: same tag, title and channel icon, and a body that no
 * longer holds the text. Only members who see previews get it; the others were never shown the text.
 * 替换已撤回消息的通知：tag、标题和频道图标不变，正文不再包含原文。只发给开启了显示内容的成员；其他成员从未看到过原文。
 */
export function retractionPushPayload(input: RetractionPushInput): PushPayload {
  const author = input.authorName.trim() || PUSH_COPY.appName;
  const direct = input.roomKind === 'direct';
  const body =
    input.reason === 'removed'
      ? PUSH_COPY.moderatorDeleted
      : input.reason === 'deleted'
        ? PUSH_COPY.deleted
        : direct
          ? PUSH_COPY.peerRecalled
          : `${author} ${PUSH_COPY.recalled}`;
  const title = direct ? author : input.roomTitle.trim() || PUSH_COPY.appName;
  return {
    title: capped(title, TITLE_MAX),
    body: capped(body, BODY_MAX),
    tag: input.roomId,
    url: roomUrl(input.baseUrl, input.roomId),
    kind: 'recall',
    roomId: input.roomId,
    ...(!direct && input.icon ? { icon: input.icon } : {}),
  };
}

export interface EventPushInput {
  event: { id: string; title: string; startsAt: string; location: string | null };
  kind: EventNotificationKind;
  /** When the notice goes out; decides between 今天 and 明天 for the morning notice. */
  /** 通知发出的时间；决定当天早上提醒写「今天」还是「明天」。 */
  now: Date;
  baseUrl: string;
  timeZone?: string;
}

function localDateKey(ms: number, timeZone: string): number {
  const w = wallClockAt(ms, timeZone);
  return Date.UTC(w.year, w.month - 1, w.day);
}

function eventTitlePrefix(input: EventPushInput, timeZone: string): string {
  if (input.kind === 'publish') return PUSH_COPY.eventPublished;
  if (input.kind === 'custom') return PUSH_COPY.eventReminder;
  // An event at or before 06:00 is announced the evening before, so the same notice says tomorrow.
  // 06:00 或更早开始的活动在前一天晚上提醒，因此同一条提醒要写「明天」。
  const days = Math.round((localDateKey(Date.parse(input.event.startsAt), timeZone) - localDateKey(input.now.getTime(), timeZone)) / 86_400_000);
  if (days === 0) return PUSH_COPY.eventToday;
  if (days === 1) return PUSH_COPY.eventTomorrow;
  return PUSH_COPY.eventReminder;
}

/** Title by kind, body is the Toronto time and the place. The tag keeps each kind of notice separate. */
/** 标题随通知类型变化，正文为多伦多时间与地点。tag 让每种通知各自独立。 */
export function eventPushPayload(input: EventPushInput): PushPayload {
  const timeZone = input.timeZone ?? NOTIFICATION_TIME_ZONE;
  const when = formatEventTimeZh(input.event.startsAt, timeZone);
  const place = input.event.location?.trim();
  return {
    title: capped(`${eventTitlePrefix(input, timeZone)}${input.event.title.trim()}`, TITLE_MAX + 10),
    body: capped(place ? `${when} · ${place}` : when, BODY_MAX),
    tag: `event:${input.event.id}:${input.kind}`,
    url: withSlash(input.baseUrl),
    kind: 'event',
    eventId: input.event.id,
  };
}

/** The tag of a post's comment and reply pushes; the notice for a deleted comment replaces them under it. */
/** 一条动态的评论和回复推送所用的 tag；评论被删除后的替换通知也使用它。 */
export function momentTag(postId: string): string {
  return `moment:${postId}`;
}

/**
 * The detail page of a post. With a comment id the page scrolls to that comment and flashes it.
 * 动态详情页。带上评论 id 时，页面会滚动到那条评论并闪烁提示。
 */
export function momentPostUrl(baseUrl: string, postId: string, commentId?: string | null): string {
  const url = `${withSlash(baseUrl)}discover/feed/post/${encodeURIComponent(postId)}`;
  return commentId ? `${url}?comment=${encodeURIComponent(commentId)}` : url;
}

/** The 消息 list of 好友动态, where a moderator's removal is explained. */
/** 好友动态的「消息」列表，管理员移除的说明显示在那里。 */
export function momentNoticesUrl(baseUrl: string): string {
  return `${withSlash(baseUrl)}discover/feed/notices`;
}

type MomentPushBase = Omit<PushPayload, 'title' | 'body'>;

/**
 * The same generic line for every moments push to a member who hides previews: no name, no text, and nothing
 * about what happened. Tag and link stay, so it still groups and opens the right page.
 * 发给关闭了显示内容的成员的所有好友动态推送都用同一句通用提示：不含名字、内容，也不说明发生了什么。tag 和链接不变，
 * 因此仍会归并，点开后也是正确的页面。
 */
function hiddenMoment(base: MomentPushBase): PushPayload {
  return { ...base, title: PUSH_COPY.appName, body: PUSH_COPY.momentHidden };
}

export interface MomentCommentPushInput {
  postId: string;
  commentId: string;
  /** comment: on the recipient's own post. reply: answering the recipient. */
  /** comment：评论了收件人自己的动态。reply：回复了收件人。 */
  kind: 'comment' | 'reply';
  actorName: string;
  /** The comment as stored, already on one line. */
  /** 已存储的评论，已经是单行。 */
  text: string;
  /** The recipient's preview switch. */
  /** 收件人的「显示消息内容」开关。 */
  preview: boolean;
  baseUrl: string;
}

/**
 * 张三评论了你：text, or 张三回复了你：text, under 好友动态. One tag per post, so a newer comment on the same post
 * replaces the older notice and still alerts. Opens the post at the comment.
 * 以「好友动态」为标题，正文为「张三评论了你：内容」或「张三回复了你：内容」。每条动态一个 tag，同一动态较新的评论会替换较旧的通知，并仍然提醒。
 * 点开后打开动态并定位到这条评论。
 */
export function momentCommentPushPayload(input: MomentCommentPushInput): PushPayload {
  const base: MomentPushBase = { tag: momentTag(input.postId), url: momentPostUrl(input.baseUrl, input.postId, input.commentId), kind: 'moment', postId: input.postId };
  if (!input.preview) return hiddenMoment(base);
  const actor = input.actorName.trim() || PUSH_COPY.momentSomeone;
  const verb = input.kind === 'reply' ? PUSH_COPY.momentReplied : PUSH_COPY.momentCommented;
  const text = input.text.replace(/\s+/g, ' ').trim();
  return { ...base, title: PUSH_COPY.momentTitle, body: capped(text ? `${actor}${verb}：${text}` : `${actor}${verb}`, BODY_MAX) };
}

export interface MomentRemovedPushInput {
  postId: string;
  target: 'post' | 'comment';
  /** The author's preview switch. */
  /** 作者的「显示消息内容」开关。 */
  preview: boolean;
  baseUrl: string;
}

/**
 * Tells the author a moderator removed their post or comment. Its own tag, so it never replaces a comment's
 * notice and a later comment never hides it. Opens the 消息 list, which says why.
 * 告诉作者，管理员移除了其动态或评论。使用单独的 tag，既不会替换评论的通知，也不会被之后的评论盖掉。点开后打开「消息」列表，那里说明了原因。
 */
export function momentRemovedPushPayload(input: MomentRemovedPushInput): PushPayload {
  const base: MomentPushBase = { tag: `${momentTag(input.postId)}:removed`, url: momentNoticesUrl(input.baseUrl), kind: 'moment', postId: input.postId };
  if (!input.preview) return hiddenMoment(base);
  return { ...base, title: PUSH_COPY.momentTitle, body: input.target === 'post' ? PUSH_COPY.momentPostRemoved : PUSH_COPY.momentCommentRemoved };
}

/**
 * Takes the place of the notice of a comment that was deleted or removed: same tag, a body without its text,
 * and quiet. Only members who see previews get it; the others were never shown the text.
 * 替换已删除或被移除的评论的通知：tag 不变，正文不再包含评论内容，且不提醒。只发给开启了显示内容的成员；其他成员从未看到过内容。
 */
export function momentRecallPushPayload(input: { postId: string; baseUrl: string }): PushPayload {
  return {
    title: PUSH_COPY.momentTitle,
    body: PUSH_COPY.momentCommentDeleted,
    tag: momentTag(input.postId),
    url: momentPostUrl(input.baseUrl, input.postId),
    kind: 'moment_recall',
    postId: input.postId,
  };
}

/** Opens Settings → Notifications, where the test was sent from. */
/** 打开「设置 → 通知」，即发送测试通知的页面。 */
export function testPushPayload(baseUrl: string): PushPayload {
  return {
    title: PUSH_COPY.appName,
    body: PUSH_COPY.testBody,
    tag: 'test',
    url: `${withSlash(baseUrl)}settings?tab=settings&screen=notifications`,
    kind: 'test',
  };
}
