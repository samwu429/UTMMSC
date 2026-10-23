import { buildPushPayload, type VapidKeys } from '@block65/webcrypto-web-push';
import { base64UrlToBytes, bytesToBase64Url, utf8ToBytes } from '../../domain/crypto/encoding';
import type { DeliveryJob, DeliveryOptions, DeliveryOutcome } from './types';

/** Contact the push services see in the VAPID token. */
/** 推送服务在 VAPID 令牌中看到的联系方式。 */
export const VAPID_SUBJECT = 'https://utmmsc.com';

const TIMEOUT_MS = 10_000;

/** Parses the private key once; null when absent or not an EC P-256 JWK with its private part. */
/** 解析一次私钥；缺失或不是带私钥部分的 EC P-256 JWK 时返回 null。 */
export function parseVapidPrivateKey(raw: string | undefined): JsonWebKey | null {
  if (!raw?.trim()) return null;
  try {
    const jwk = JSON.parse(raw) as JsonWebKey;
    if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || typeof jwk.d !== 'string' || typeof jwk.x !== 'string' || typeof jwk.y !== 'string') return null;
    return jwk;
  } catch {
    return null;
  }
}

/**
 * Web Push topics allow at most 32 URL-safe base64 characters, and room ids contain a colon, so the
 * tag is hashed into that alphabet.
 * Web Push 的 Topic 最多 32 个 URL 安全的 base64 字符，而房间 id 含有冒号，所以把 tag 哈希到这个字符集。
 */
export async function pushTopic(tag: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', utf8ToBytes(tag)));
  return bytesToBase64Url(digest.slice(0, 24));
}

/**
 * The push services browsers subscribe with: Google (Chrome, Edge on Android, Samsung Internet, Opera),
 * Mozilla (Firefox), Apple (Safari) and Microsoft (Edge on Windows). The Worker posts only to these, on
 * the default port, so a member cannot point it at any other address.
 * 浏览器订阅时使用的推送服务：Google（Chrome、安卓版 Edge、三星浏览器、Opera）、Mozilla（Firefox）、Apple（Safari）
 * 和 Microsoft（Windows 版 Edge）。Worker 只向这些服务的默认端口发送，成员无法让它请求其他地址。
 */
const PUSH_SERVICE_HOSTS = new Set(['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'push.services.mozilla.com']);
const PUSH_SERVICE_SUFFIXES = ['.push.apple.com', '.notify.windows.com'];

export function isPushServiceEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port !== '') return false;
  const host = url.hostname.toLowerCase();
  return PUSH_SERVICE_HOSTS.has(host) || PUSH_SERVICE_SUFFIXES.some((suffix) => host.endsWith(suffix) && host.length > suffix.length);
}

/**
 * 404 and 410 mean the subscription is gone. 401, 403, 429 and 5xx are on the sender's or service's side:
 * Google and Apple answer 403 for a VAPID token they reject, which must not wear down healthy devices. A
 * redirect is never followed and counts against the device, like any other refusal.
 * 404 和 410 表示订阅已失效。401、403、429 和 5xx 属于发送方或推送服务的问题：Google 和 Apple 拒绝 VAPID 令牌时返回 403，
 * 不能因此消耗正常设备的失败次数。重定向一律不跟随，与其他拒绝一样记在设备头上。
 */
export function classifyWebPushStatus(status: number): DeliveryOutcome {
  if (status >= 200 && status < 300) return 'sent';
  if (status === 404 || status === 410) return 'gone';
  if (status === 401 || status === 403 || status === 429 || status >= 500) return 'transient';
  return 'failed';
}

function payloadRecord(job: DeliveryJob): Record<string, string> {
  const record: Record<string, string> = {};
  for (const [key, value] of Object.entries(job.payload)) if (typeof value === 'string') record[key] = value;
  return record;
}

/**
 * The VAPID keys in the raw form the library takes: the public key as the uncompressed point, the private
 * key as the JWK's d. Both come from the one private JWK secret, and GET /notifications/vapid-key serves the
 * same public key, so browsers always subscribe with the key the server signs with.
 * 库所需的原始形式的 VAPID 密钥：公钥为未压缩的点，私钥为 JWK 的 d。二者都取自同一个私钥 JWK 机密，
 * GET /notifications/vapid-key 提供的也是这个公钥，因此浏览器订阅所用的公钥始终与服务器签名所用的一致。
 */
export function vapidKeysFromJwk(privateKey: JsonWebKey): VapidKeys {
  const x = base64UrlToBytes(privateKey.x ?? '') ?? new Uint8Array();
  const y = base64UrlToBytes(privateKey.y ?? '') ?? new Uint8Array();
  const point = new Uint8Array(1 + x.length + y.length);
  point[0] = 0x04;
  point.set(x, 1);
  point.set(y, 1 + x.length);
  return { subject: VAPID_SUBJECT, publicKey: bytesToBase64Url(point), privateKey: privateKey.d };
}

/**
 * Encrypts with aes128gcm (RFC 8291), the encoding every current push service accepts and the only one
 * Apple's does, and signs a VAPID token valid for 12 hours.
 * 使用 aes128gcm（RFC 8291）加密，这是所有现行推送服务都接受、也是 Apple 唯一接受的编码，并签发有效期 12 小时的 VAPID 令牌。
 */
export async function sendWebPush(privateKey: JsonWebKey, job: DeliveryJob, options: DeliveryOptions): Promise<DeliveryOutcome> {
  if (!job.keys || !isPushServiceEndpoint(job.endpoint)) return 'gone';
  let request: Awaited<ReturnType<typeof buildPushPayload>>;
  try {
    request = await buildPushPayload(
      { data: payloadRecord(job), options: { ttl: options.ttl, urgency: options.urgency, topic: await pushTopic(job.payload.tag) } },
      { endpoint: job.endpoint, expirationTime: null, keys: job.keys },
      vapidKeysFromJwk(privateKey),
    );
  } catch {
    // The server key was checked beforehand, so this is the subscription's own keys or endpoint.
    // 服务器密钥已事先检查，因此这里出错的是订阅自身的密钥或地址。
    return 'failed';
  }
  try {
    const response = await fetch(job.endpoint, { method: 'POST', headers: request.headers, body: request.body, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
    const reply = await response.text().catch(() => '');
    const outcome = classifyWebPushStatus(response.status);
    // Only the push service's host goes in the log: the rest of the endpoint lets anyone push to the device.
    // 日志中只记录推送服务的主机名：endpoint 的其余部分能让任何人向这台设备推送。
    if (outcome !== 'sent') console.error(`webpush: push ${outcome} with ${response.status} from ${new URL(job.endpoint).host}${reply ? ` (${reply.slice(0, 200)})` : ''}`);
    return outcome;
  } catch (err) {
    console.error('webpush: push request failed', err instanceof Error ? err.message : String(err));
    return 'transient';
  }
}
