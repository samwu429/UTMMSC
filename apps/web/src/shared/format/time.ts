const TIME = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
const DATE_TIME = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const FULL = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Today shows the clock only; older messages add month and day. */
/** 当天只显示时间；更早的消息加上月日。 */
export function formatMessageTime(iso: string): string {
  const date = new Date(iso);
  return sameDay(date, new Date()) ? TIME.format(date) : DATE_TIME.format(date);
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
  return FULL.format(new Date(iso));
}

export function formatRelative(iso: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return DATE_TIME.format(new Date(iso));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
