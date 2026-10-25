import type { PushPayload } from '@utmmsc/shared';
import { bytesToBase64Url, utf8ToBytes } from '../../domain/crypto/encoding';
import type { DeliveryJob, DeliveryOptions, DeliveryOutcome } from './types';

export const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ASSERTION_SECONDS = 60 * 60;
/** Cached access tokens are replaced this long before Google says they expire. */
/** 缓存的访问令牌在 Google 给出的过期时间之前这么久就会更换。 */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 10_000;

/** Small notification icon and accent colour, matching the Android resources. */
/** 小通知图标和强调色，与安卓资源一致。 */
export const ANDROID_NOTIFICATION_ICON = 'ic_stat_notify';
export const ANDROID_NOTIFICATION_COLOR = '#3C165F';

export interface ServiceAccount {
  projectId: string;
  clientEmail: string;
  privateKey: string;
  privateKeyId: string | null;
}

/** Reads the Firebase service-account JSON; null when absent or missing the fields FCM needs. */
/** 读取 Firebase 服务账号 JSON；缺失或缺少 FCM 所需字段时返回 null。 */
export function parseServiceAccount(raw: string | undefined): ServiceAccount | null {
  if (!raw?.trim()) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const { project_id: projectId, client_email: clientEmail, private_key: privateKey, private_key_id: privateKeyId } = record;
  if (typeof projectId !== 'string' || typeof clientEmail !== 'string' || typeof privateKey !== 'string') return null;
  if (!projectId || !clientEmail || !privateKey.includes('PRIVATE KEY')) return null;
  return {
    projectId,
    clientEmail,
    // A key pasted with its newlines still escaped is read the same way.
    // 换行符仍是转义形式的密钥也按同样方式读取。
    privateKey: privateKey.replace(/\\n/g, '\n'),
    privateKeyId: typeof privateKeyId === 'string' && privateKeyId ? privateKeyId : null,
  };
}

export interface FcmJwtClaims {
  iss: string;
  scope: string;
  aud: string;
  iat: number;
  exp: number;
}

export function fcmJwtClaims(account: ServiceAccount, nowSeconds: number): FcmJwtClaims {
  return { iss: account.clientEmail, scope: FCM_SCOPE, aud: GOOGLE_TOKEN_URL, iat: nowSeconds, exp: nowSeconds + ASSERTION_SECONDS };
}

function pemToDer(pem: string): Uint8Array | null {
  const body = pem
    .replace(/-----BEGIN [A-Z ]+-----/, '')
    .replace(/-----END [A-Z ]+-----/, '')
    .replace(/\s+/g, '');
  try {
    const binary = atob(body);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

const keyCache = new Map<string, Promise<CryptoKey>>();

function signingKey(pem: string): Promise<CryptoKey> {
  let key = keyCache.get(pem);
  if (!key) {
    const der = pemToDer(pem);
    key = der
      ? crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
      : Promise.reject(new Error('service account private key is not PEM'));
    keyCache.set(pem, key);
    key.catch(() => keyCache.delete(pem));
  }
  return key;
}

/** RS256 assertion for Google's token endpoint, signed with the service account's key. */
/** 发往 Google 令牌端点的 RS256 断言，用服务账号的密钥签名。 */
export async function signServiceAccountJwt(account: ServiceAccount, nowSeconds: number): Promise<string> {
  const header = { alg: 'RS256', typ: 'JWT', ...(account.privateKeyId ? { kid: account.privateKeyId } : {}) };
  const unsigned = `${bytesToBase64Url(utf8ToBytes(JSON.stringify(header)))}.${bytesToBase64Url(utf8ToBytes(JSON.stringify(fcmJwtClaims(account, nowSeconds))))}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await signingKey(account.privateKey), utf8ToBytes(unsigned));
  return `${unsigned}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

interface CachedToken {
  clientEmail: string;
  token: string;
  refreshAt: number;
}

let cachedToken: CachedToken | null = null;
let pendingToken: Promise<string | null> | null = null;

/** Drops the cached access token, for example after FCM rejects it. */
/** 丢弃缓存的访问令牌，例如在 FCM 拒绝它之后。 */
export function forgetFcmAccessToken(): void {
  cachedToken = null;
}

async function requestAccessToken(account: ServiceAccount, now: number): Promise<string | null> {
  try {
    const assertion = await signServiceAccountJwt(account, Math.floor(now / 1000));
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await response.json().catch(() => null)) as { access_token?: unknown; expires_in?: unknown; error?: unknown; error_description?: unknown } | null;
    if (!response.ok || typeof body?.access_token !== 'string') {
      // Google's reason, such as invalid_grant for a revoked key or a clock problem; it never contains the key.
      // Google 给出的原因，例如密钥已吊销或时间不对时的 invalid_grant；其中不含密钥本身。
      const reason = [body?.error, body?.error_description].filter((part) => typeof part === 'string').join(': ').slice(0, 200);
      console.error(`fcm: token exchange failed with status ${response.status}${reason ? ` (${reason})` : ''}`);
      return null;
    }
    const lifetime = typeof body.expires_in === 'number' && body.expires_in > 0 ? body.expires_in * 1000 : ASSERTION_SECONDS * 1000;
    cachedToken = { clientEmail: account.clientEmail, token: body.access_token, refreshAt: now + Math.max(lifetime - REFRESH_MARGIN_MS, 60_000) };
    return body.access_token;
  } catch (err) {
    console.error('fcm: token exchange failed', err instanceof Error ? err.message : String(err));
    return null;
  }
}

/** OAuth access token for FCM, kept in module scope until shortly before it expires. */
/** FCM 的 OAuth 访问令牌，保存在模块作用域中，直到快要过期。 */
export async function fcmAccessToken(account: ServiceAccount, now: number = Date.now()): Promise<string | null> {
  if (cachedToken && cachedToken.clientEmail === account.clientEmail && now < cachedToken.refreshAt) return cachedToken.token;
  if (!pendingToken) {
    pendingToken = requestAccessToken(account, now).finally(() => {
      pendingToken = null;
    });
  }
  return pendingToken;
}

/**
 * FCM v1 message. Data values must be strings; notification messages show in the tray when the app is in
 * the background. Chat pushes collapse by room, so a phone that was offline gets only the newest one per
 * chat, and the notice for a withdrawn message replaces the queued original instead of following it.
 * FCM v1 消息。data 的值必须是字符串；应用在后台时，notification 消息显示在通知栏。聊天推送按房间合并：离线的手机每个聊天只收到最新的一条，
 * 已撤回消息的替换通知会取代排队中的原通知，而不是排在它后面。
 *
 * Android 7 has no channels, so sound, vibration and the banner come from the message itself; Android 8 and
 * later ignore these three fields in favour of the channel.
 * Android 7 没有通知渠道，声音、振动和横幅都取决于消息本身；Android 8 及以上忽略这三个字段，以渠道设置为准。
 *
 * Friend update activity goes to its own channel at normal priority, since nobody waits on it the way they
 * wait on a chat, and collapses by post like chat does by room. The notice that replaces a deleted comment
 * also keeps Android 7 quiet.
 * 好友动态的互动通知使用单独的渠道和普通优先级，因为它不像聊天那样有人在等；并像聊天按房间合并一样按动态合并。
 * 替换已删除评论的通知在 Android 7 上也不发出声音和振动。
 *
 * Timetable reminders go to the timetable channel at high priority and collapse by tag, so a phone that was
 * offline gets one live class notice, not a queue of stale ones. ttlSeconds is a delivery hint and never
 * becomes a data field.
 * 课表提醒使用 timetable 渠道和高优先级，并按 tag 合并：离线的手机只会收到一条仍然有效的上课通知，而不是一串过时的通知。
 * ttlSeconds 只是投递提示，从不放进 data。
 */
export function buildFcmMessage(token: string, payload: PushPayload, options: DeliveryOptions): Record<string, unknown> {
  const data: Record<string, string> = { url: payload.url, kind: payload.kind, tag: payload.tag };
  if (payload.roomId) data.roomId = payload.roomId;
  if (payload.eventId) data.eventId = payload.eventId;
  if (payload.postId) data.postId = payload.postId;
  const chat = payload.kind === 'message' || payload.kind === 'recall';
  const moment = payload.kind === 'moment' || payload.kind === 'moment_recall';
  const timetable = payload.kind === 'class' || payload.kind === 'assignment';
  const alerts = payload.kind !== 'moment_recall';
  return {
    message: {
      token,
      notification: { title: payload.title, body: payload.body },
      android: {
        priority: moment ? 'NORMAL' : 'HIGH',
        ttl: `${options.ttl}s`,
        ...(chat || moment || timetable ? { collapse_key: payload.tag } : {}),
        notification: {
          channel_id: moment ? 'moments' : timetable ? 'timetable' : payload.kind === 'event' ? 'events' : 'messages',
          tag: payload.tag,
          icon: ANDROID_NOTIFICATION_ICON,
          color: ANDROID_NOTIFICATION_COLOR,
          notification_priority: moment ? 'PRIORITY_DEFAULT' : 'PRIORITY_HIGH',
          default_sound: alerts,
          default_vibrate_timings: alerts,
        },
      },
      data,
    },
  };
}

interface FcmErrorDetail {
  '@type'?: string;
  errorCode?: string;
  fieldViolations?: { field?: string }[];
}

interface FcmError {
  status?: string;
  message?: string;
  details?: FcmErrorDetail[];
}

function fcmErrorCodes(body: unknown): { error: FcmError | undefined; details: FcmErrorDetail[]; codes: Set<string> } {
  const error = (body as { error?: FcmError } | null)?.error;
  const details = Array.isArray(error?.details) ? error.details : [];
  const codes = new Set(details.map((d) => d?.errorCode).filter((c): c is string => typeof c === 'string'));
  if (error?.status) codes.add(error.status);
  return { error, details, codes };
}

/**
 * UNREGISTERED is permanent, and INVALID_ARGUMENT counts as gone only when it is about the token; otherwise
 * the message itself was refused. A token from another Firebase project counts as a refusal, removed after
 * five like any other: it also follows from a service account of the wrong project, which must not wipe
 * every phone on the first push. A 404 without UNREGISTERED names our project, not the device.
 * UNREGISTERED 是永久性错误；INVALID_ARGUMENT 只有在针对令牌时才视为设备失效，否则是消息本身被拒绝。属于其他 Firebase
 * 项目的令牌按一次拒绝计算，和其他拒绝一样满五次后删除：服务账号属于错误的项目时也会出现这个错误，不能因为第一次推送就清空所有手机。
 * 不带 UNREGISTERED 的 404 指的是我方项目，而不是设备。
 */
export function classifyFcmResponse(status: number, body: unknown): DeliveryOutcome {
  if (status >= 200 && status < 300) return 'sent';
  const { error, details, codes } = fcmErrorCodes(body);
  if (codes.has('UNREGISTERED')) return 'gone';
  if (codes.has('SENDER_ID_MISMATCH')) return 'failed';
  if (status === 404) return 'transient';
  if (status === 400 || codes.has('INVALID_ARGUMENT')) {
    const aboutToken =
      details.some((d) => Array.isArray(d?.fieldViolations) && d.fieldViolations.some((v) => v?.field === 'message.token')) ||
      /registration token/i.test(error?.message ?? '');
    return aboutToken ? 'gone' : 'failed';
  }
  if (status === 401 || status === 403 || status === 429 || status >= 500) return 'transient';
  return 'failed';
}

export async function sendFcm(account: ServiceAccount, accessToken: string, job: DeliveryJob, options: DeliveryOptions): Promise<DeliveryOutcome> {
  try {
    const response = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.projectId)}/messages:send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(buildFcmMessage(job.endpoint, job.payload, options)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = response.ok ? await response.arrayBuffer().then(() => null) : await response.json().catch(() => null);
    if (response.status === 401) forgetFcmAccessToken();
    const outcome = classifyFcmResponse(response.status, body);
    if (outcome !== 'sent') console.error(`fcm: push ${outcome} with ${describeFcmError(response.status, body)}`);
    return outcome;
  } catch (err) {
    console.error('fcm: push request failed', err instanceof Error ? err.message : String(err));
    return 'transient';
  }
}

/** Status, error codes and FCM's message for the log; FCM's messages name fields, never the token. */
/** 写入日志的状态码、错误码和 FCM 的说明；FCM 的说明只提字段名，从不包含令牌。 */
export function describeFcmError(status: number, body: unknown): string {
  const { error, codes } = fcmErrorCodes(body);
  const parts = [String(status), ...codes];
  if (typeof error?.message === 'string' && error.message) parts.push(error.message.slice(0, 200));
  return parts.join(' ');
}
