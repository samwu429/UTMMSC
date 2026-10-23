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
  eventPublished: '活动：',
  eventToday: '今天的活动：',
  eventTomorrow: '明天的活动：',
  eventReminder: '活动提醒：',
  testBody: '通知已开启，这是一条测试通知',
  recalled: '撤回了一条消息',
  peerRecalled: '对方撤回了一条消息',
  deleted: '一条消息已被删除',
  moderatorDeleted: '管理员删除了一条消息',
} as const;

const TITLE_MAX = 60;
const BODY_MAX = 160;

function capped(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
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
  /** Named in the message or covered by @所有人. */
  /** 消息中 @ 了此人，或使用了 @所有人。 */
  mentioned: boolean;
  /** The recipient's preview switch. */
  /** 收件人的「显示消息内容」开关。 */
  preview: boolean;
  baseUrl: string;
}

/**
 * WeChat style: a channel shows its name over "sender: text", a direct message shows the sender over
 * the text. The room id is the tag, so a newer push for the same chat replaces the older one.
 * 与微信一致：频道以频道名为标题、「发送人: 内容」为正文；私聊以发送人为标题、内容为正文。房间 id 作为 tag，同一聊天较新的推送会替换较旧的一条。
 */
export function messagePushPayload(input: MessagePushInput): PushPayload {
  const base = { tag: input.roomId, url: roomUrl(input.baseUrl, input.roomId), kind: 'message' as const, roomId: input.roomId };
  if (!input.preview) return { ...base, title: PUSH_COPY.appName, body: PUSH_COPY.hiddenMessage };
  const content = previewOf(input.text, input.hasImage) || PUSH_COPY.image;
  const author = input.authorName.trim() || PUSH_COPY.appName;
  if (input.roomKind === 'direct') {
    return { ...base, title: capped(author, TITLE_MAX), body: capped(content, BODY_MAX) };
  }
  const line = `${input.mentioned ? PUSH_COPY.mentionPrefix : ''}${author}: ${content}`;
  return { ...base, title: capped(input.roomTitle.trim() || PUSH_COPY.appName, TITLE_MAX), body: capped(line, BODY_MAX) };
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
}

/**
 * Takes the place of a withdrawn message's notice: same tag and title, and a body that no longer holds
 * the text. Only members who see previews get it; the others were never shown the text.
 * 替换已撤回消息的通知：tag 和标题不变，正文不再包含原文。只发给开启了显示内容的成员；其他成员从未看到过原文。
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
