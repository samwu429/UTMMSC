/** D1 stores timestamps as ISO-8601 strings in UTC; this is the single formatter used everywhere. */
/** D1 以 UTC 的 ISO-8601 字符串存时间戳；全项目统一使用此格式化函数。 */
export function nowIso(): string {
  return new Date().toISOString();
}

export function isoAfter(ms: number, from: Date = new Date()): string {
  return new Date(from.getTime() + ms).toISOString();
}
