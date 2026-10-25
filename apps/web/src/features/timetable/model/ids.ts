/**
 * Owner: T3, timetable web core. Ids the app chooses, so the offline outbox can create a course and its assignment
 * before either has synced.
 * 维护者：T3，课表网页核心。由 App 生成的 id，使离线队列能在同步之前就创建课程及其作业。
 */
import type { TimetableIdPrefix } from '@utmmsc/shared';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** The prefix and 22 base64url characters from 16 random bytes, matching TIMETABLE_ID. */
/** 前缀加上由 16 个随机字节得到的 22 个 base64url 字符，符合 TIMETABLE_ID。 */
export function newTimetableId(prefix: TimetableIdPrefix): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    // Only the bits not yet written matter, at most 13, so the rest are masked off.
    // 只有尚未写出的位有用，最多 13 位，其余的位被屏蔽。
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      out += ALPHABET[(value >> bits) & 63];
    }
  }
  // 128 bits leave 2 over, which make the 22nd character.
  // 128 位还剩 2 位，组成第 22 个字符。
  if (bits > 0) out += ALPHABET[(value << (6 - bits)) & 63];
  return `${prefix}_${out}`;
}
