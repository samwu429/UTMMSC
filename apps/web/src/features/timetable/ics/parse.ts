/**
 * Owner: T4, timetable import and export. Reads a calendar file (Google, Outlook, Apple, a Quercus feed, or this
 * app's own export) into plain events, keeping only what the import plan needs. Never throws on a bad file; a
 * broken event is skipped.
 * 维护者：T4，课表导入导出。把日历文件（Google、Outlook、Apple、Quercus 日历，或本 App 自己导出的文件）读成简单的事件，
 * 只保留导入计划需要的内容。文件有问题时不会抛错，损坏的事件会被跳过。
 */
import {
  parseIcsDateTime,
  parseIcsDateTimes,
  parseIcsDuration,
  parseIcsLine,
  resolveIcsZone,
  unescapeIcsText,
  unfoldIcs,
  type IcsDateTime,
  type IcsProperty,
} from './ics';

/** RRULE parts this app reads. */
/** 本 App 读取的 RRULE 部分。 */
export interface IcsRule {
  freq: string;
  interval: number;
  /** Two-letter days (MO..SU); ordinal prefixes such as 1MO are dropped. */
  /** 两个字母的星期（MO..SU）；1MO 这类序数前缀被去掉。 */
  byDay: string[];
  until: IcsDateTime | null;
  count: number | null;
}

export interface IcsEvent {
  uid: string | null;
  summary: string;
  description: string;
  location: string;
  /** Upper case, such as CANCELLED; null when absent. */
  /** 大写，例如 CANCELLED；缺省时为 null。 */
  status: string | null;
  start: IcsDateTime;
  end: IcsDateTime | null;
  /** DURATION in milliseconds, when there is no DTEND. */
  /** 没有 DTEND 时的 DURATION（毫秒）。 */
  durationMs: number | null;
  rule: IcsRule | null;
  /** True when the event repeats in a way this app cannot read (RDATE, or an RRULE it cannot parse). */
  /** 事件以本 App 无法读取的方式重复（RDATE，或无法解析的 RRULE）时为 true。 */
  unreadableRepeat: boolean;
  exdates: IcsDateTime[];
  /** Set on an event that replaces one occurrence of a repeating event with the same UID. */
  /** 替换同一 UID 重复事件中某一次的事件会带有此项。 */
  recurrenceId: IcsDateTime | null;
  /** X-UTMMSC-* properties of this app's own export, by name without the prefix (KIND, COLOR...). */
  /** 本 App 自己导出的 X-UTMMSC-* 属性，键为去掉前缀的名称（KIND、COLOR……）。 */
  extras: Record<string, string>;
}

export interface IcsCalendar {
  events: IcsEvent[];
  /** The file's own TZIDs mapped to IANA zones, from its VTIMEZONE blocks. */
  /** 文件自己的 TZID 到 IANA 时区的映射，来自其中的 VTIMEZONE。 */
  zones: Map<string, string>;
}

const EXTRA_PREFIX = 'X-UTMMSC-';
const DAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

function readRule(value: string): IcsRule | null {
  const parts = new Map<string, string>();
  for (const part of value.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) parts.set(part.slice(0, eq).trim().toUpperCase(), part.slice(eq + 1).trim());
  }
  const freq = parts.get('FREQ')?.toUpperCase();
  if (!freq) return null;
  const intervalText = parts.get('INTERVAL');
  const interval = intervalText === undefined ? 1 : Number(intervalText);
  if (!Number.isInteger(interval) || interval < 1) return null;
  const byDay: string[] = [];
  for (const raw of (parts.get('BYDAY') ?? '').split(',')) {
    const day = raw.trim().toUpperCase().replace(/^[+-]?\d+/, '');
    if (DAY_CODES.includes(day) && !byDay.includes(day)) byDay.push(day);
  }
  const untilText = parts.get('UNTIL');
  const until = untilText ? parseIcsDateTime(untilText) : null;
  if (untilText && !until) return null;
  const countText = parts.get('COUNT');
  const count = countText === undefined ? null : Number(countText);
  if (count !== null && (!Number.isInteger(count) || count < 1)) return null;
  return { freq, interval, byDay, until, count };
}

/**
 * Standard and daylight offsets of a VTIMEZONE, so a TZID the browser does not know (Outlook writes descriptions
 * such as "(UTC-05:00) Eastern Time (US & Canada)") can still be placed when its rules are the usual ones.
 * VTIMEZONE 的标准时与夏令时偏移，使浏览器不认识的 TZID（Outlook 会写「(UTC-05:00) Eastern Time (US & Canada)」这类描述）
 * 在规则常见时仍能确定时区。
 */
function zoneFromOffsets(standard: string | null, daylight: string | null): string | null {
  const key = `${standard ?? ''}/${daylight ?? ''}`;
  const known: Record<string, string> = {
    '-0500/-0400': 'America/Toronto',
    '-0600/-0500': 'America/Chicago',
    '-0700/-0600': 'America/Denver',
    '-0800/-0700': 'America/Los_Angeles',
    '-0400/-0300': 'America/Halifax',
    '+0800/': 'Asia/Shanghai',
    '+0000/': 'UTC',
    '+0000/+0100': 'Europe/London',
  };
  return known[key] ?? null;
}

/** Reads the whole file. Events outside BEGIN:VEVENT/END:VEVENT and nested alarms are ignored. */
/** 读取整个文件。BEGIN:VEVENT/END:VEVENT 之外的内容和嵌套的提醒被忽略。 */
export function parseIcs(text: string): IcsCalendar {
  const events: IcsEvent[] = [];
  const zones = new Map<string, string>();
  // The open components, innermost last, and the properties of the event being read.
  // 尚未结束的组件（最内层在最后），以及正在读取的事件的属性。
  const stack: string[] = [];
  let props: IcsProperty[] | null = null;
  let zone: { tzid: string | null; standard: string | null; daylight: string | null } | null = null;

  for (const line of unfoldIcs(text)) {
    const property = parseIcsLine(line);
    if (!property) continue;
    if (property.name === 'BEGIN') {
      const component = property.value.trim().toUpperCase();
      stack.push(component);
      if (component === 'VEVENT') props = [];
      if (component === 'VTIMEZONE') zone = { tzid: null, standard: null, daylight: null };
      continue;
    }
    if (property.name === 'END') {
      const component = stack.pop();
      if (component === 'VEVENT' && props) {
        const event = readEvent(props);
        if (event) events.push(event);
        props = null;
      }
      if (component === 'VTIMEZONE' && zone) {
        if (zone.tzid && !zones.has(zone.tzid)) {
          const named = resolveIcsZone(zone.tzid) ?? zoneFromOffsets(zone.standard, zone.daylight);
          if (named) zones.set(zone.tzid, named);
        }
        zone = null;
      }
      continue;
    }
    const inside = stack[stack.length - 1];
    if (inside === 'VEVENT' && props) props.push(property);
    else if (zone && inside === 'VTIMEZONE' && property.name === 'TZID') zone.tzid = property.value.trim();
    else if (zone && (inside === 'STANDARD' || inside === 'DAYLIGHT') && property.name === 'TZOFFSETTO') {
      if (inside === 'STANDARD') zone.standard ??= property.value.trim();
      else zone.daylight ??= property.value.trim();
    }
  }
  return { events, zones };
}

function readEvent(props: readonly IcsProperty[]): IcsEvent | null {
  const first = (name: string) => props.find((property) => property.name === name);
  const text = (name: string) => {
    const property = first(name);
    return property ? unescapeIcsText(property.value).trim() : '';
  };
  const dateTime = (property: IcsProperty | undefined) => (property ? parseIcsDateTime(property.value, property.params.TZID ?? null) : null);

  const start = dateTime(first('DTSTART'));
  if (!start) return null;
  const durationText = first('DURATION')?.value;
  const rruleText = first('RRULE')?.value;
  const rule = rruleText ? readRule(rruleText) : null;
  const extras: Record<string, string> = {};
  for (const property of props) {
    if (property.name.startsWith(EXTRA_PREFIX)) extras[property.name.slice(EXTRA_PREFIX.length)] ??= unescapeIcsText(property.value).trim();
  }
  const status = text('STATUS');
  return {
    uid: text('UID') || null,
    summary: text('SUMMARY'),
    description: text('DESCRIPTION'),
    location: text('LOCATION'),
    status: status ? status.toUpperCase() : null,
    start,
    end: dateTime(first('DTEND')),
    durationMs: durationText ? parseIcsDuration(durationText) : null,
    rule,
    unreadableRepeat: (rruleText !== undefined && rule === null) || first('RDATE') !== undefined,
    exdates: props.filter((property) => property.name === 'EXDATE').flatMap(parseIcsDateTimes),
    recurrenceId: dateTime(first('RECURRENCE-ID')),
    extras,
  };
}
