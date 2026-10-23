// Generates a VAPID key pair for Web Push. Prints only the public key; the private JWK goes to a gitignored file.
// 生成 Web Push 的 VAPID 密钥对。只打印公钥；私钥 JWK 写入被 git 忽略的文件。
import { writeFileSync } from 'node:fs';

const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
writeFileSync(new URL('../.vapid-private.json', import.meta.url), JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d }));
console.log(Buffer.from(raw).toString('base64url'));
