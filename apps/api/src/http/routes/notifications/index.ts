import { Hono } from 'hono';
import type {
  NotificationPrefs,
  NotificationPrefsResponse,
  PushDeviceKind,
  TestNotificationResponse,
  UpdateNotificationPrefsBody,
  VapidKeyResponse,
  WebPushKeys,
} from '@utmmsc/shared';
import { testPushPayload } from '../../../domain/notifications/payloads';
import { isMissingSchemaError } from '../../../infrastructure/d1/channels';
import { findNotificationPrefs, updateNotificationPrefs } from '../../../infrastructure/d1/notification-prefs';
import { removePushDevice, upsertPushDevice } from '../../../infrastructure/d1/push-devices';
import { isPushServiceEndpoint, parseVapidPrivateKey } from '../../../infrastructure/push/webpush';
import { sendToMembers } from '../../../infrastructure/push/send';
import type { AppEnv } from '../../context';
import { badRequest, serviceUnavailable } from '../../errors';
import { rateLimit } from '../../middleware/rate-limit';
import { requireSession } from '../../middleware/session';
import { readJson } from '../../validation';

export const notificationRoutes = new Hono<AppEnv>();

export const ENDPOINT_MAX = 1000;
export const PUSH_KEY_MAX = 200;
export const FCM_TOKEN_MAX = 4096;
const PLATFORM_MAX = 40;

const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;
const FCM_TOKEN = /^[A-Za-z0-9_:.-]+$/;
const PLATFORM = /^[A-Za-z0-9 _.()-]+$/;

const pushUnavailable = () => serviceUnavailable('push_unavailable', '通知服务尚未开通');
const invalidDevice = () => badRequest('invalid_device', '设备信息格式错误');

export interface ParsedDevice {
  kind: PushDeviceKind;
  endpoint: string;
  keys: WebPushKeys | null;
  platform: string | null;
}

function readPlatform(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw invalidDevice();
  const trimmed = value.trim().slice(0, PLATFORM_MAX);
  return trimmed && PLATFORM.test(trimmed) ? trimmed : null;
}

function readPushKey(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > PUSH_KEY_MAX || !BASE64URL.test(value)) throw invalidDevice();
  return value;
}

/**
 * Web Push endpoints must be https URLs; a new registration must also point at a known push service,
 * while removal takes any https URL so an older row can still be dropped. FCM tokens use the token
 * alphabet. Sizes are capped.
 * Web Push 的 endpoint 必须是 https 地址；新登记的地址还必须属于已知的推送服务，而删除接受任何 https 地址，旧记录因此仍能删除。
 * FCM 令牌只能使用令牌字符。长度都有上限。
 */
export function readWebPushEndpoint(value: unknown, use: 'register' | 'remove' = 'register'): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > ENDPOINT_MAX) throw invalidDevice();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalidDevice();
  }
  if (url.protocol !== 'https:' || url.username || url.password) throw invalidDevice();
  if (use === 'register' && !isPushServiceEndpoint(value)) throw invalidDevice();
  return value;
}

export function readFcmToken(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > FCM_TOKEN_MAX || !FCM_TOKEN.test(value)) throw invalidDevice();
  return value;
}

export function readDeviceRegistration(body: Record<string, unknown>): ParsedDevice {
  if (body.kind === 'webpush') {
    const keys = body.keys;
    if (typeof keys !== 'object' || keys === null || Array.isArray(keys)) throw invalidDevice();
    const record = keys as Record<string, unknown>;
    return {
      kind: 'webpush',
      endpoint: readWebPushEndpoint(body.endpoint),
      keys: { p256dh: readPushKey(record.p256dh), auth: readPushKey(record.auth) },
      platform: readPlatform(body.platform),
    };
  }
  if (body.kind === 'fcm') return { kind: 'fcm', endpoint: readFcmToken(body.token), keys: null, platform: readPlatform(body.platform) };
  throw invalidDevice();
}

/** The key browsers subscribe with. 503 until both halves of the VAPID pair are configured. */
/** 浏览器订阅时使用的公钥。VAPID 公私钥都配置好之前返回 503。 */
notificationRoutes.get('/vapid-key', (c) => {
  const publicKey = c.env.VAPID_PUBLIC_KEY?.trim();
  if (!publicKey || !parseVapidPrivateKey(c.env.VAPID_PRIVATE_KEY)) throw pushUnavailable();
  const response: VapidKeyResponse = { publicKey };
  return c.json(response);
});

notificationRoutes.post('/devices', rateLimit(30, 60_000), requireSession, async (c) => {
  const device = readDeviceRegistration(await readJson<Record<string, unknown>>(c));
  try {
    await upsertPushDevice(c.env.DB, { ...device, memberId: c.get('member').id, sessionId: c.get('sessionId') });
  } catch (err) {
    if (isMissingSchemaError(err)) throw pushUnavailable();
    throw err;
  }
  return c.json({ ok: true });
});

notificationRoutes.delete('/devices', rateLimit(30, 60_000), requireSession, async (c) => {
  const body = await readJson<Record<string, unknown>>(c);
  const endpoint = body.endpoint !== undefined ? readWebPushEndpoint(body.endpoint, 'remove') : body.token !== undefined ? readFcmToken(body.token) : null;
  if (!endpoint) throw invalidDevice();
  try {
    const removed = await removePushDevice(c.env.DB, c.get('member').id, endpoint);
    return c.json({ ok: true, removed });
  } catch (err) {
    if (isMissingSchemaError(err)) return c.json({ ok: true, removed: false });
    throw err;
  }
});

notificationRoutes.get('/prefs', requireSession, async (c) => {
  const response: NotificationPrefsResponse = { prefs: await findNotificationPrefs(c.env.DB, c.get('member').id) };
  return c.json(response);
});

const PREF_FIELDS: Record<keyof NotificationPrefs, string> = {
  messages: '新消息通知',
  events: '活动通知',
  preview: '通知显示消息内容',
};

notificationRoutes.patch('/prefs', rateLimit(60, 60_000), requireSession, async (c) => {
  const body = await readJson<Record<string, unknown>>(c);
  const patch: UpdateNotificationPrefsBody = {};
  for (const key of Object.keys(PREF_FIELDS) as (keyof NotificationPrefs)[]) {
    const value = body[key];
    if (value === undefined) continue;
    if (typeof value !== 'boolean') throw badRequest('invalid_field', `${PREF_FIELDS[key]} 格式错误`);
    patch[key] = value;
  }
  try {
    const response: NotificationPrefsResponse = { prefs: await updateNotificationPrefs(c.env.DB, c.get('member').id, patch) };
    return c.json(response);
  } catch (err) {
    if (isMissingSchemaError(err)) throw pushUnavailable();
    throw err;
  }
});

/** Sends to the caller's own live devices, whatever their switches say, so they can check the setup. */
/** 发送到调用者自己的有效设备，不受通知开关影响，用于检查设置是否正常。 */
notificationRoutes.post('/test', rateLimit(5, 60_000), requireSession, async (c) => {
  const payload = testPushPayload(c.env.APP_BASE_URL);
  const summary = await sendToMembers(c.env, [c.get('member').id], () => payload);
  const response: TestNotificationResponse = { sent: summary.sent, failed: summary.failed, devices: summary.devices };
  return c.json(response);
});
