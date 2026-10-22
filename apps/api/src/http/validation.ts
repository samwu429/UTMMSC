import type { Context } from 'hono';
import { badRequest } from './errors';

/** Decodes a percent-encoded storage key; malformed input is a 400, not a crash. */
/** 解码百分号编码的存储键；格式错误返回 400 而不是崩溃。 */
export function decodeKeyPath(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    throw badRequest('invalid_path', '路径格式错误');
  }
}

/** Reads a JSON body and guarantees an object; field checks happen in each route. */
/** 读取 JSON 请求体并保证为对象；字段校验在各路由中进行。 */
export async function readJson<T extends object>(c: Context): Promise<T> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw badRequest('invalid_json', '请求格式错误');
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw badRequest('invalid_json', '请求格式错误');
  return body as T;
}

export function requireString(value: unknown, field: string, max = 500): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw badRequest('missing_field', `缺少 ${field}`);
  if (value.length > max) throw badRequest('field_too_long', `${field} 过长`);
  return value.trim();
}

export function optionalString(value: unknown, field: string, max = 500): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw badRequest('invalid_field', `${field} 格式错误`);
  if (value.length > max) throw badRequest('field_too_long', `${field} 过长`);
  return value.trim();
}

export function requireOneOf<T extends string>(value: unknown, options: readonly T[], field: string): T {
  if (typeof value !== 'string' || !(options as readonly string[]).includes(value)) {
    throw badRequest('invalid_field', `${field} 取值无效`);
  }
  return value as T;
}

export function requireInteger(value: unknown, field: string): number {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n)) throw badRequest('invalid_field', `${field} 必须是整数`);
  return n;
}
