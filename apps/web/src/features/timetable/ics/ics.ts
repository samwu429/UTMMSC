/**
 * Owner: T4, timetable import and export. The iCalendar (RFC 5545) pieces both directions share: text escaping,
 * folding at 75 octets, content lines with parameters, date-time values, and turning a value in any zone into
 * Toronto wall time.
 * 维护者：T4，课表导入导出。导入和导出共用的 iCalendar（RFC 5545）基础部分：文字转义、按 75 个字节折行、带参数的内容行、
 * 日期时间值，以及把任意时区的值换算成多伦多本地时间。
 */
import { TIMETABLE_TIME_ZONE, instantAt, isTimetableDate, torontoDateOf, torontoMinuteOf, wallClockAt, wallTimeToUtcMs } from '@utmmsc/shared';

export const CRLF = '\r\n';
/** RFC 5545 3.1: a content line is at most 75 octets before its line break. */
/** RFC 5545 3.1：内容行在换行之前最多 75 个字节。 */
export const ICS_LINE_OCTETS = 75;

function utf8Size(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
}

/** TEXT values: backslash, semicolon and comma are escaped, and a line break is written as \n. */
/** TEXT 值：转义反斜杠、分号和逗号，换行写作 \n。 */
export function escapeIcsText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n?|\n/g, '\\n');
}

/** The reverse of escapeIcsText, in one pass so an escaped backslash before n stays a backslash and an n. */
/** escapeIcsText 的逆操作，一次扫描完成，因此转义的反斜杠后面跟着 n 时仍是反斜杠加 n。 */
export function unescapeIcsText(value: string): string {
  return value.replace(/\\([\\;,nN])/g, (_, ch: string) => (ch === 'n' || ch === 'N' ? '\n' : ch));
}

/**
 * Folds one content line: no physical line is longer than 75 octets, each continuation starts with a space, and
 * a character is never split, so Chinese text and emoji survive any reader.
 * 折叠一行内容：每个物理行都不超过 75 个字节，续行以空格开头，且不会把一个字符拆开，中文和表情在任何读取程序中都完整。
 */
export function foldIcsLine(line: string): string {
  const parts: string[] = [];
  let current = '';
  let bytes = 0;
  let limit = ICS_LINE_OCTETS;
  for (const ch of line) {
    const size = utf8Size(ch.codePointAt(0) ?? 0);
    if (bytes + size > limit) {
      parts.push(current);
      current = '';
      bytes = 0;
      // The leading space of a continuation line counts toward its 75 octets.
      // 续行开头的空格也计入它的 75 个字节。
      limit = ICS_LINE_OCTETS - 1;
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.join(`${CRLF} `);
}

/** Lines of a calendar file with folding undone; CRLF, LF and lone CR endings are all accepted. */
/** 取消折行后的日历文件各行；CRLF、LF 和单独的 CR 结尾都可以。 */
export function unfoldIcs(text: string): string[] {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n')
    .filter((line) => line.trim() !== '');
}

export interface IcsProperty {
  /** Upper case, such as DTSTART or X-UTMMSC-KIND. */
  /** 大写，例如 DTSTART 或 X-UTMMSC-KIND。 */
  name: string;
  /** Parameter names upper case; quotes removed from the values. */
  /** 参数名为大写；参数值已去掉引号。 */
  params: Record<string, string>;
  /** Raw value, still escaped. */
  /** 原始值，仍带转义。 */
  value: string;
}

/** NAME;PARAM=value;PARAM="quoted: value":VALUE, or null when the line has no colon after its name. */
/** NAME;PARAM=value;PARAM="带引号: 的值":VALUE；名称之后没有冒号时为 null。 */
export function parseIcsLine(line: string): IcsProperty | null {
  let index = 0;
  const readUntil = (stops: string): string => {
    const start = index;
    while (index < line.length && !stops.includes(line[index] ?? '')) index += 1;
    return line.slice(start, index);
  };
  const name = readUntil(';:').trim().toUpperCase();
  if (!name) return null;
  const params: Record<string, string> = {};
  while (line[index] === ';') {
    index += 1;
    const key = readUntil('=;:').trim().toUpperCase();
    let value = '';
    if (line[index] === '=') {
      index += 1;
      // A value may list several parts, each quoted or not: a,"b:c".
      // 一个参数值可以有多个部分，每部分可带引号也可不带：a,"b:c"。
      for (;;) {
        if (line[index] === '"') {
          const close = line.indexOf('"', index + 1);
          if (close === -1) return null;
          value += line.slice(index + 1, close);
          index = close + 1;
        } else {
          value += readUntil(',;:');
        }
        if (line[index] !== ',') break;
        value += ',';
        index += 1;
      }
    }
    if (key) params[key] = value;
  }
  if (line[index] !== ':') return null;
  return { name, params, value: line.slice(index + 1) };
}

/** One content line written out: parameters quoted when they hold a separator. Not folded. */
/** 写出一行内容：参数含分隔符时加引号。不折行。 */
export function icsLine(name: string, value: string, params: Readonly<Record<string, string>> = {}): string {
  let out = name;
  for (const [key, param] of Object.entries(params)) out += `;${key}=${/[;:,]/.test(param) ? `"${param.replace(/"/g, '')}"` : param}`;
  return `${out}:${value}`;
}

/* Date-time values */
/* 日期时间值 */

/** A DATE or DATE-TIME value as written: its own calendar date and clock, and which zone it is in. */
/** 文件中写的 DATE 或 DATE-TIME 值：它自己的日历日期和时钟时间，以及所在时区。 */
export interface IcsDateTime {
  /** YYYY-MM-DD as written. */
  /** 按原文的 YYYY-MM-DD。 */
  date: string;
  /** Minutes after midnight, or null for a DATE (all-day) value. */
  /** 午夜起的分钟数；DATE（全天）值为 null。 */
  minute: number | null;
  second: number;
  /** Ends in Z. */
  /** 以 Z 结尾。 */
  utc: boolean;
  /** The TZID parameter, or null for UTC, floating and DATE values. */
  /** TZID 参数；UTC、浮动时间和 DATE 值为 null。 */
  tzid: string | null;
}

const ICS_DATE = /^(\d{4})(\d{2})(\d{2})$/;
const ICS_DATE_TIME = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/;

/** One DATE or DATE-TIME value, or null when it is not a real date and time. */
/** 一个 DATE 或 DATE-TIME 值；不是真实的日期时间时为 null。 */
export function parseIcsDateTime(raw: string, tzid: string | null = null): IcsDateTime | null {
  const value = raw.trim();
  const dateOnly = ICS_DATE.exec(value);
  if (dateOnly) {
    const date = `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}`;
    return isTimetableDate(date) ? { date, minute: null, second: 0, utc: false, tzid: null } : null;
  }
  const match = ICS_DATE_TIME.exec(value);
  if (!match) return null;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  // 60 is a leap second.
  // 60 表示闰秒。
  const second = Math.min(59, Number(match[6]));
  if (!isTimetableDate(date) || hour > 23 || minute > 59 || Number(match[6]) > 60) return null;
  const utc = match[7] === 'Z';
  return { date, minute: hour * 60 + minute, second, utc, tzid: utc ? null : tzid };
}

/** The values of a property such as EXDATE, which may list several, with its TZID applied to each. */
/** EXDATE 等可列出多个值的属性，每个值都使用该属性的 TZID。 */
export function parseIcsDateTimes(property: IcsProperty): IcsDateTime[] {
  const tzid = property.params.TZID ?? null;
  return property.value
    .split(',')
    .map((part) => parseIcsDateTime(part, tzid))
    .filter((value): value is IcsDateTime => value !== null);
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

/** 20260910T100000 for a Toronto date and minute, used with TZID=America/Toronto. */
/** 多伦多日期和分钟写作 20260910T100000，与 TZID=America/Toronto 一起使用。 */
export function formatIcsLocal(date: string, minute: number): string {
  return `${date.replace(/-/g, '')}T${pad(Math.floor(minute / 60))}${pad(minute % 60)}00`;
}

/** 20261209T045959Z for an instant. */
/** 某一时刻写作 20261209T045959Z。 */
export function formatIcsUtc(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getUTCFullYear(), 4)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

/* Zones */
/* 时区 */

/** Windows zone names, which Outlook writes as TZID, for the zones UTM members are likely to export from. */
/** Outlook 会把 Windows 时区名写成 TZID；这里列出 UTM 成员可能导出所用的时区。 */
const WINDOWS_ZONES: Readonly<Record<string, string>> = {
  'eastern standard time': 'America/Toronto',
  'us eastern standard time': 'America/Toronto',
  'central standard time': 'America/Chicago',
  'mountain standard time': 'America/Denver',
  'pacific standard time': 'America/Los_Angeles',
  'atlantic standard time': 'America/Halifax',
  'newfoundland standard time': 'America/St_Johns',
  'china standard time': 'Asia/Shanghai',
  'taipei standard time': 'Asia/Taipei',
  'tokyo standard time': 'Asia/Tokyo',
  'korea standard time': 'Asia/Seoul',
  'singapore standard time': 'Asia/Singapore',
  'india standard time': 'Asia/Kolkata',
  'gmt standard time': 'Europe/London',
  'w. europe standard time': 'Europe/Berlin',
  'romance standard time': 'Europe/Paris',
  utc: 'UTC',
  'coordinated universal time': 'UTC',
};

function knownZone(zone: string): boolean {
  try {
    wallClockAt(0, zone);
    return true;
  } catch {
    return false;
  }
}

/**
 * The IANA zone a TZID names, or null when it cannot be told. Accepts IANA names, Windows names, prefixed
 * names such as /mozilla.org/20050126_1/America/Toronto, and descriptions such as "(UTC-05:00) Eastern Time".
 * TZID 对应的 IANA 时区；无法判断时为 null。接受 IANA 名称、Windows 名称、带前缀的名称（如 /mozilla.org/20050126_1/America/Toronto），
 * 以及「(UTC-05:00) Eastern Time」这类描述。
 */
export function resolveIcsZone(tzid: string): string | null {
  const name = tzid.trim().replace(/^"|"$/g, '');
  if (!name) return null;
  const windows = WINDOWS_ZONES[name.toLowerCase()];
  if (windows) return windows;
  if (/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+$/.test(name) && knownZone(name)) return name;
  const segments = name.split('/').filter(Boolean);
  for (let take = Math.min(3, segments.length); take >= 2; take -= 1) {
    const candidate = segments.slice(-take).join('/');
    if (/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+$/.test(candidate) && knownZone(candidate)) return candidate;
  }
  const lower = name.toLowerCase();
  if (lower.includes('eastern')) return 'America/Toronto';
  if (lower.includes('central')) return 'America/Chicago';
  if (lower.includes('mountain')) return 'America/Denver';
  if (lower.includes('pacific')) return 'America/Los_Angeles';
  if (lower.includes('beijing') || lower.includes('china') || lower.includes('shanghai')) return 'Asia/Shanghai';
  return null;
}

/** A Toronto date and minute: the timetable's own way of saying when. */
/** 多伦多日期和分钟：课表自己表示时间的方式。 */
export interface TorontoWallTime {
  date: string;
  minute: number;
}

/**
 * Where a DATE-TIME value falls on Toronto's wall clock. UTC values are converted; a TZID in another zone is
 * converted through that zone; Toronto, floating values and zones that cannot be told are read as Toronto time.
 * `zones` maps a file's own TZIDs to IANA names (from its VTIMEZONE blocks). Null for a DATE value.
 * DATE-TIME 值在多伦多时钟上的位置。UTC 值会被换算；其他时区的 TZID 经该时区换算；多伦多时间、浮动时间以及无法判断的时区按多伦多时间读取。
 * `zones` 把文件自己的 TZID 映射为 IANA 名称（来自其中的 VTIMEZONE）。DATE 值返回 null。
 */
export function torontoWallTime(value: IcsDateTime, zones: ReadonlyMap<string, string> = new Map()): TorontoWallTime | null {
  const ms = icsInstant(value, zones);
  if (ms === null) return null;
  return { date: torontoDateOf(ms), minute: torontoMinuteOf(ms) };
}

/** The instant a DATE-TIME value names, with the same zone rules as torontoWallTime; null for a DATE value. */
/** DATE-TIME 值所指的时刻，时区规则与 torontoWallTime 相同；DATE 值返回 null。 */
export function icsInstant(value: IcsDateTime, zones: ReadonlyMap<string, string> = new Map()): number | null {
  if (value.minute === null) return null;
  const [year, month, day] = value.date.split('-').map(Number) as [number, number, number];
  const hour = Math.floor(value.minute / 60);
  const minute = value.minute % 60;
  if (value.utc) return Date.UTC(year, month - 1, day, hour, minute, value.second);
  const zone = value.tzid ? (zones.get(value.tzid) ?? resolveIcsZone(value.tzid)) : null;
  if (zone && zone !== TIMETABLE_TIME_ZONE) return wallTimeToUtcMs(year, month, day, hour, minute, zone) + value.second * 1000;
  return instantAt(value.date, value.minute) + value.second * 1000;
}

/**
 * An RFC 5545 duration such as PT1H30M, P1D, -P1W in milliseconds (days as 24 hours, which is how an event's
 * length is read); null when it is not one.
 * RFC 5545 时长（例如 PT1H30M、P1D、-P1W）换算成毫秒（按读取事件长度的方式，一天算 24 小时）；格式不对时为 null。
 */
export function parseIcsDuration(raw: string): number | null {
  const match = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(raw.trim());
  if (!match || raw.trim().endsWith('T') || raw.trim() === 'P') return null;
  const [, sign, weeks, days, hours, minutes, seconds] = match;
  const ms =
    (Number(weeks ?? 0) * 7 * 24 * 3600 + Number(days ?? 0) * 24 * 3600 + Number(hours ?? 0) * 3600 + Number(minutes ?? 0) * 60 + Number(seconds ?? 0)) * 1000;
  return sign === '-' ? -ms : ms;
}
