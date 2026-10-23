/** Decodes a base64url VAPID public key into the bytes pushManager.subscribe expects. */
/** 把 base64url 编码的 VAPID 公钥解码为 pushManager.subscribe 所需的字节。 */
export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** True when a subscription was made with this key; a rotated key needs a new subscription. */
/** 订阅是否使用这把公钥创建；公钥更换后需要重新订阅。 */
export function sameKey(current: ArrayBuffer | ArrayBufferView | null | undefined, expected: Uint8Array): boolean {
  if (!current) return false;
  const bytes = current instanceof ArrayBuffer ? new Uint8Array(current) : new Uint8Array(current.buffer, current.byteOffset, current.byteLength);
  if (bytes.length !== expected.length) return false;
  for (let i = 0; i < bytes.length; i += 1) if (bytes[i] !== expected[i]) return false;
  return true;
}
