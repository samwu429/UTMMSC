import type { PushDeviceKind, PushKind, PushPayload, WebPushKeys } from '@utmmsc/shared';

/** One push to one device. Plain data, so it can be handed to the relay object. */
/** 发往一台设备的一次推送。只含普通数据，可以交给中继对象。 */
export interface DeliveryJob {
  deviceId: string;
  kind: PushDeviceKind;
  /** Subscription URL for webpush, registration token for fcm. */
  /** webpush 为订阅地址，fcm 为注册令牌。 */
  endpoint: string;
  keys: WebPushKeys | null;
  payload: PushPayload;
}

/**
 * sent: accepted by the push service. gone: the service says the device no longer exists. failed: the
 * device or its keys were refused. transient: the service or our credentials failed, not the device.
 * skipped: this kind of push is not configured.
 * sent：推送服务已接受。gone：推送服务表示设备已不存在。failed：设备或其密钥被拒绝。transient：推送服务或我方凭据出错，与设备无关。skipped：这类推送尚未配置。
 */
export type DeliveryOutcome = 'sent' | 'gone' | 'failed' | 'transient' | 'skipped';

export interface JobOutcome {
  deviceId: string;
  outcome: DeliveryOutcome;
}

export interface DeliveryOptions {
  /** Seconds the push service keeps the message for an offline device. */
  /** 设备离线时推送服务保留消息的秒数。 */
  ttl: number;
  urgency: 'normal' | 'high';
}

const DAY_SECONDS = 24 * 60 * 60;

/**
 * Chat messages are urgent and stale after a day, and so is the notice that replaces a withdrawn one,
 * which must reach the device as soon as the original could; event notices may wait two days. Friend
 * update activity, and the notice that replaces a deleted comment, keeps for a day at normal urgency.
 * 聊天消息较紧急，一天后失去意义；替换已撤回消息的通知也一样，它必须和原通知一样快地到达设备。活动通知可保留两天。
 * 好友动态的互动通知，以及替换已删除评论的通知，以普通紧急程度保留一天。
 */
export function deliveryOptions(kind: PushKind): DeliveryOptions {
  switch (kind) {
    case 'message':
    case 'recall':
      return { ttl: DAY_SECONDS, urgency: 'high' };
    case 'event':
      return { ttl: 2 * DAY_SECONDS, urgency: 'normal' };
    case 'moment':
    case 'moment_recall':
      return { ttl: DAY_SECONDS, urgency: 'normal' };
    case 'test':
      return { ttl: 60 * 60, urgency: 'high' };
  }
}
