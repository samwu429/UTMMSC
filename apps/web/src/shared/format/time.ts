import { useLocaleStore, type Locale } from '../i18n/locale';

function tag(): string {
  return useLocaleStore.getState().locale === 'en' ? 'en-CA' : 'zh-CN';
}

function timeFormat() {
  return new Intl.DateTimeFormat(tag(), { hour: '2-digit', minute: '2-digit', hour12: false });
}

function dateTimeFormat() {
  return new Intl.DateTimeFormat(tag(), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

function fullFormat() {
  return new Intl.DateTimeFormat(tag(), { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Today shows the clock only; older messages add month and day. */
/** 当天只显示时间；更早的消息加上月日。 */
export function formatMessageTime(iso: string): string {
  const date = new Date(iso);
  return sameDay(date, new Date()) ? timeFormat().format(date) : dateTimeFormat().format(date);
}

const CHAT_GROUP_GAP_MS = 5 * 60 * 1000;

/** WeChat-style separator: first message, a new day, or a gap of at least five minutes. */
/** 微信式时间条：第一条、跨天，或间隔至少五分钟。 */
export function showChatTimeDivider(currentIso: string, previousIso?: string): boolean {
  if (!previousIso) return true;
  const current = new Date(currentIso);
  const previous = new Date(previousIso);
  if (Number.isNaN(current.getTime()) || Number.isNaN(previous.getTime())) return true;
  if (!sameDay(current, previous)) return true;
  return current.getTime() - previous.getTime() >= CHAT_GROUP_GAP_MS;
}

/*
 * Chat labels use fixed month and weekday names instead of Intl, so they read the same on every
 * device and tests stay deterministic. Day distance counts calendar days, not 24-hour windows.
 * 聊天时间标签使用固定的月份和星期名称而不是 Intl，各设备显示一致，测试结果也稳定。
 * 相隔天数按日历日计算，而不是按 24 小时计算。
 */
const ZH_WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
const EN_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const EN_WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const EN_MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 24 * 60 * 60 * 1000;

function currentLocale(locale?: Locale): Locale {
  return locale ?? useLocaleStore.getState().locale;
}

function clock(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** Whole calendar days from `date` to `now` in local time; negative when `date` is a later day. */
/** 按本地日历计算从 `date` 到 `now` 相隔的整天数；`date` 在之后的日子时为负数。 */
function calendarDaysBetween(date: Date, now: Date): number {
  const from = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const to = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((to - from) / DAY_MS);
}

/**
 * Centred time line inside a conversation: 14:32, 昨天 14:32, 星期一 14:32 (2 to 6 days ago),
 * 10月8日 14:32 (same year) or 2025年10月8日 14:32.
 * 会话中居中的时间条：14:32、昨天 14:32、星期一 14:32（2 至 6 天前）、10月8日 14:32（同一年）或 2025年10月8日 14:32。
 */
export function formatDividerTime(iso: string, nowMs: number = Date.now(), locale?: Locale): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const english = currentLocale(locale) === 'en';
  const now = new Date(nowMs);
  const days = calendarDaysBetween(date, now);
  const time = clock(date);
  if (days === 0) return time;
  if (days === 1) return english ? `Yesterday ${time}` : `昨天 ${time}`;
  if (days >= 2 && days <= 6) return english ? `${EN_WEEKDAYS[date.getDay()]} ${time}` : `${ZH_WEEKDAYS[date.getDay()]} ${time}`;
  const month = date.getMonth();
  const day = date.getDate();
  if (date.getFullYear() === now.getFullYear()) return english ? `${EN_MONTHS_SHORT[month]} ${day} ${time}` : `${month + 1}月${day}日 ${time}`;
  return english ? `${EN_MONTHS_SHORT[month]} ${day}, ${date.getFullYear()} ${time}` : `${date.getFullYear()}年${month + 1}月${day}日 ${time}`;
}

/**
 * Time column of the conversation list: 14:32, 昨天, 星期一 (2 to 6 days ago) or 25/10/8.
 * 会话列表右侧的时间：14:32、昨天、星期一（2 至 6 天前）或 25/10/8。
 */
export function formatChatListTime(iso: string, nowMs: number = Date.now(), locale?: Locale): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const english = currentLocale(locale) === 'en';
  const days = calendarDaysBetween(date, new Date(nowMs));
  if (days === 0) return clock(date);
  if (days === 1) return english ? 'Yesterday' : '昨天';
  if (days >= 2 && days <= 6) return english ? (EN_WEEKDAYS_SHORT[date.getDay()] ?? '') : (ZH_WEEKDAYS[date.getDay()] ?? '');
  const year = String(date.getFullYear() % 100).padStart(2, '0');
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return english ? `${month}/${day}/${year}` : `${year}/${month}/${day}`;
}

export function formatEventTime(iso: string): string {
  return fullFormat().format(new Date(iso));
}

export function formatRelative(iso: string | null): string {
  if (!iso) return '';
  const english = useLocaleStore.getState().locale === 'en';
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return english ? 'Just now' : '刚刚';
  if (minutes < 60) return english ? `${minutes} min ago` : `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return english ? `${hours} hr ago` : `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return english ? `${days} d ago` : `${days} 天前`;
  return dateTimeFormat().format(new Date(iso));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
