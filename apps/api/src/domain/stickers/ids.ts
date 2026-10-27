import { bytesToBase64Url, utf8ToBytes } from '../crypto/encoding';

/**
 * Sticker ids and still tokens. Both are keyed hashes (HMAC-SHA-256 with SESSION_SECRET) of a SHA-256 the client
 * sends and R2 verifies on every put, so the same bytes get the same id for everyone, and nobody can compute an id
 * from a file without the secret. Self-contained, so domain/crypto/hmac.ts stays as it is.
 * 表情 id 和静态缩略图令牌。两者都是客户端发来的 SHA-256 的带密钥哈希（用 SESSION_SECRET 做 HMAC-SHA-256），R2 在每次写入时校验这个 SHA-256，
 * 因此相同的字节对所有人都得到相同的 id，而没有密钥的人无法根据文件算出 id。本文件自成一体，domain/crypto/hmac.ts 保持不变。
 */

/** base64url characters kept from the signature: 132 bits. */
/** 从签名中保留的 base64url 字符数：132 位。 */
const KEPT = 22;

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', utf8ToBytes(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, utf8ToBytes(message));
  return bytesToBase64Url(new Uint8Array(signature)).slice(0, KEPT);
}

/**
 * The id of the sticker file whose SHA-256 is `sha256Hex` (64 lowercase hex): stk_ and 22 base64url characters.
 * 以 `sha256Hex`（64 个小写十六进制字符）为 SHA-256 的表情文件的 id：stk_ 加 22 个 base64url 字符。
 */
export async function stickerObjectId(secret: string, sha256Hex: string): Promise<string> {
  return `stk_${await hmac(secret, `sticker-object:v1:${sha256Hex}`)}`;
}

/**
 * The token of one still of sticker `id`, from the still's SHA-256: 22 base64url characters, stored at
 * sticker/<id>-t-<token>. The id is part of the message, so one still image gives each sticker its own token.
 * 表情 `id` 的某个静态缩略图的令牌，由该缩略图的 SHA-256 得出：22 个 base64url 字符，存放在 sticker/<id>-t-<令牌>。
 * id 是消息的一部分，因此同一张静态图在不同表情下得到不同的令牌。
 */
export async function stickerThumbToken(secret: string, id: string, thumbSha256Hex: string): Promise<string> {
  return hmac(secret, `sticker-thumb:v1:${id}:${thumbSha256Hex}`);
}
