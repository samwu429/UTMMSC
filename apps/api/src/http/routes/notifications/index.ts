import { Hono, type Context } from 'hono';
import {
  TEST_NOTIFICATION_DELAY_MAX,
  type NotificationPrefs,
  type NotificationPrefsResponse,
  type PushDeviceKind,
  type TestNotificationResponse,
  type UpdateNotificationPrefsBody,
  type VapidKeyResponse,
  type WebPushKeys,
} from '@utmmsc/shared';
import { testPushPayload } from '../../../domain/notifications/payloads';
import { isMissingSchemaError } from '../../../infrastructure/d1/channels';
import { findNotificationPrefs, updateNotificationPrefs } from '../../../infrastructure/d1/notification-prefs';
import { removePushDevice, upsertPushDevice } from '../../../infrastructure/d1/push-devices';
import { isPushServiceEndpoint, parseVapidPrivateKey, vapidKeysFromJwk } from '../../../infrastructure/push/webpush';
import { sendTestPush } from '../../../infrastructure/push/send';
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

/**
 * The key browsers subscribe with, derived from the private key the server signs with, so a hand-copied
 * public key that drifted from it cannot make every push fail. 503 until the private key is configured.
 * 浏览器订阅时使用的公钥，由服务器签名用的私钥推导，手工复制的公钥即使与私钥不一致，也不会让所有推送失败。私钥配置好之前返回 503。
 */
notificationRoutes.get('/vapid-key', (c) => {
  const privateKey = parseVapidPrivateKey(c.env.VAPID_PRIVATE_KEY);
  const publicKey = privateKey ? vapidKeysFromJwk(privateKey).publicKey : undefined;
  if (!publicKey) throw pushUnavailable();
  const configured = c.env.VAPID_PUBLIC_KEY?.trim();
  if (configured && configured !== publicKey) console.warn('push: VAPID_PUBLIC_KEY does not match VAPID_PRIVATE_KEY; serving the key derived from the private key');
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
  moments: '好友动态互动通知',
  timetable: '课表提醒',
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

/** Seconds to wait before the test push; older clients send no body and get it at once. */
/** 发送测试推送前等待的秒数；旧客户端不发请求体，立即发送。 */
export function readTestDelay(body: Record<string, unknown> | null): number {
  const value = body?.delaySeconds;
  if (value === undefined || value === null) return 0;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > TEST_NOTIFICATION_DELAY_MAX) {
    throw badRequest('invalid_field', '等待时间格式错误');
  }
  return value;
}

async function readOptionalJson(c: Context<AppEnv>): Promise<Record<string, unknown> | null> {
  const text = await c.req.text().catch(() => '');
  if (!text.trim()) return null;
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    // Reported below like any other malformed body.
    // 与其他格式错误的请求体一样在下面报告。
  }
  throw badRequest('invalid_json', '请求格式错误');
}

/**
 * Sends to the caller's own live devices, whatever their switches say, so they can check the setup. With a
 * delay the answer waits for the push; the send is kept alive if the app goes to the background meanwhile
 * and its connection drops.
 * 发送到调用者自己的有效设备，不受通知开关影响，用于检查设置是否正常。有等待时间时，响应会等推送发出后再返回；
 * 期间 App 进入后台、连接中断时，发送仍会继续。
 */
notificationRoutes.post('/test', rateLimit(5, 60_000), requireSession, async (c) => {
  const delaySeconds = readTestDelay(await readOptionalJson(c));
  const payload = testPushPayload(c.env.APP_BASE_URL);
  const memberId = c.get('member').id;
  const sessionId = c.get('sessionId');
  const send = (async (): Promise<TestNotificationResponse> => {
    if (delaySeconds > 0) await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000));
    return sendTestPush(c.env, memberId, sessionId, payload);
  })();
  c.executionCtx.waitUntil(send.catch(() => undefined));
  return c.json(await send);
});
