/** Per-member notification switches. A member without a stored row has every switch on. */
/** 每位成员的通知开关。没有记录的成员所有开关都是开启的。 */
export interface NotificationPrefs {
  /** New chat messages. */
  /** 新消息。 */
  messages: boolean;
  /** Club events: published, the morning of, and custom reminders. */
  /** 社团活动：发布时、当天早上和自定义提醒。 */
  events: boolean;
  /** Show the sender and text; off shows a generic line instead. */
  /** 显示发送人和内容；关闭时只显示一句通用提示。 */
  preview: boolean;
  /** 好友动态: comments and replies to the member, and a moderator acting on their content. Likes never push. */
  /** 好友动态：别人评论、回复了成员，或管理员处理了成员的内容。点赞从不推送。 */
  moments: boolean;
}

export const DEFAULT_NOTIFICATION_PREFS: Readonly<NotificationPrefs> = Object.freeze({ messages: true, events: true, preview: true, moments: true });

export const PUSH_DEVICE_KINDS = ['webpush', 'fcm'] as const;
export type PushDeviceKind = (typeof PUSH_DEVICE_KINDS)[number];

/** Web Push subscription keys as PushSubscription.toJSON() returns them (base64url). */
/** 与 PushSubscription.toJSON() 返回的一致的 Web Push 订阅密钥（base64url）。 */
export interface WebPushKeys {
  p256dh: string;
  auth: string;
}

/** Body of POST /notifications/devices: a browser subscription, or an FCM token from the Android app. */
/** POST /notifications/devices 的请求体：浏览器订阅，或安卓应用的 FCM 令牌。 */
export type PushDeviceRegistration =
  | { kind: 'webpush'; endpoint: string; keys: WebPushKeys; platform?: string }
  | { kind: 'fcm'; token: string; platform?: string };

/** Body of DELETE /notifications/devices. */
/** DELETE /notifications/devices 的请求体。 */
export type RemovePushDeviceBody = { endpoint: string } | { token: string };

export const EVENT_NOTIFICATION_KINDS = ['publish', 'morning', 'custom'] as const;
export type EventNotificationKind = (typeof EVENT_NOTIFICATION_KINDS)[number];

export const EVENT_NOTIFICATION_STATUSES = ['pending', 'sending', 'sent', 'cancelled', 'failed'] as const;
export type EventNotificationStatus = (typeof EVENT_NOTIFICATION_STATUSES)[number];

/** Custom reminder times one event may carry. */
/** 每个活动最多可设置的自定义提醒时间数。 */
export const EVENT_CUSTOM_TIMES_MAX = 5;

/** What the publisher chooses when creating an event. customTimes are ISO instants. */
/** 发布人在创建活动时的通知选择。customTimes 为 ISO 时间。 */
export interface EventNotificationPlan {
  notifyOnPublish: boolean;
  notifyMorningOf: boolean;
  customTimes: string[];
}

export const DEFAULT_EVENT_NOTIFICATION_PLAN: Readonly<EventNotificationPlan> = Object.freeze({
  notifyOnPublish: true,
  notifyMorningOf: true,
  customTimes: [],
});

/** One scheduled notice of an event, as the admin event list shows it. */
/** 活动的一条通知计划，供管理后台的活动列表显示。 */
export interface EventNotificationRow {
  id: string;
  kind: EventNotificationKind;
  sendAt: string;
  status: EventNotificationStatus;
  sentAt: string | null;
  /** Members reached on at least one device; null until sent. */
  /** 至少在一台设备上收到的成员数；发送前为 null。 */
  recipientCount: number | null;
}

/**
 * message: a new chat message. recall: replaces the notice of a message that was recalled or removed,
 * under the same tag, quietly where the device allows it. event: a club event notice. test: from Settings.
 * moment: a comment, a reply or a moderator's removal in 好友动态, which alerts. moment_recall: replaces the
 * notice of a comment that was deleted, under the same tag, quietly.
 * message：新聊天消息。recall：消息被撤回或删除后，以相同 tag 替换其通知，设备允许时不再提醒。event：社团活动通知。test：来自设置页。
 * moment：好友动态中的评论、回复或管理员移除，会提醒。moment_recall：评论被删除后，以相同 tag 安静地替换其通知。
 */
export const PUSH_KINDS = ['message', 'recall', 'event', 'test', 'moment', 'moment_recall'] as const;
export type PushKind = (typeof PUSH_KINDS)[number];

/**
 * What a device receives. Web Push carries it as the JSON body; FCM carries title and body as the
 * notification and the rest as data. `tag` groups notifications so a newer one replaces an older one.
 * 设备收到的内容。Web Push 以 JSON 正文传送；FCM 把标题和正文放在 notification 中，其余放在 data 中。
 * `tag` 用于归并通知，较新的一条会替换较旧的一条。
 */
export interface PushPayload {
  title: string;
  body: string;
  tag: string;
  url: string;
  kind: PushKind;
  roomId?: string;
  eventId?: string;
  postId?: string;
}
