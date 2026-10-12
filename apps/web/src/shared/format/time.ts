import { useLocaleStore } from '../i18n/locale';

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
