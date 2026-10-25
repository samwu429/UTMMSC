import {
  NOTIFICATION_TIME_ZONE,
  isoToZonedLocal,
  wallClockAt,
  wallTimeToUtcMs,
  type AdminEventRecord,
  type EventNotificationRow,
} from '@utmmsc/shared';
import { plural, sectionPath, type Phrase } from '../sections';

/**
 * 活动 without the screens: the 即将开始 / 已结束 split in Toronto time, the date block and clock of each row, the notice
 * summary chip, and the draft a 复制为新活动 starts from. Pure, so it is tested without a browser.
 * 不含界面的「活动」：按多伦多时间划分「即将开始 / 已结束」，每一行的日期块和时间，通知摘要标签，以及「复制为新活动」所用的草稿。纯函数，
 * 无需浏览器即可测试。
 */

export const EVENT_VIEWS = ['upcoming', 'past'] as const;
export type EventView = (typeof EVENT_VIEWS)[number];

/** /admin/events/new is the create form, so no event id can be "new". */
/** /admin/events/new 是新建表单，因此没有活动的 id 能是「new」。 */
export const NEW_EVENT = 'new';

const HOUR_MS = 60 * 60 * 1000;
/** A copy's start must leave room for its notices, so it lands at least this far ahead. */
/** 复制出的活动开始时间要给通知留出余地，因此至少在这么久之后。 */
const DUPLICATE_LEAD_MS = 2 * HOUR_MS;

const WEEKDAYS_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function readEventView(raw: string | null): EventView {
  return raw === 'past' ? 'past' : 'upcoming';
}

/** The list (?view=past for 已结束), an event, or the create form, which may start from a copy (?from=<id>). */
/** 列表（已结束为 ?view=past）、某个活动，或新建表单（可以从副本开始，?from=<id>）。 */
export function eventsListPath(view: EventView = 'upcoming'): string {
  const base = sectionPath('events');
  return view === 'past' ? `${base}?view=past` : base;
}

export function eventPath(id: string, view: EventView = 'upcoming'): string {
  const path = `${sectionPath('events')}/${encodeURIComponent(id)}`;
  return view === 'past' ? `${path}?view=past` : path;
}

export function newEventPath(from?: string | null, view: EventView = 'upcoming'): string {
  const params = new URLSearchParams();
  if (view === 'past') params.set('view', 'past');
  if (from) params.set('from', from);
  const query = params.toString();
  return `${sectionPath('events')}/${NEW_EVENT}${query ? `?${query}` : ''}`;
}

function startOfTorontoDay(nowMs: number): number {
  const w = wallClockAt(nowMs, NOTIFICATION_TIME_ZONE);
  return wallTimeToUtcMs(w.year, w.month, w.day, 0, 0, NOTIFICATION_TIME_ZONE);
}

/**
 * Upcoming means today or later in Toronto, so an event stays under 即将开始 for the whole of its day, while it is on.
 * 「即将开始」指多伦多时间的今天或之后，因此活动在当天进行期间整天都留在「即将开始」中。
 */
export function isUpcoming(event: Pick<AdminEventRecord, 'startsAt'>, nowMs: number): boolean {
  const start = Date.parse(event.startsAt);
  return !Number.isNaN(start) && start >= startOfTorontoDay(nowMs);
}

/** 即将开始 soonest first, 已结束 most recent first. */
/** 「即将开始」最近的在前，「已结束」最晚结束的在前。 */
export function splitEvents(events: readonly AdminEventRecord[], nowMs: number): Record<EventView, AdminEventRecord[]> {
  const upcoming: AdminEventRecord[] = [];
  const past: AdminEventRecord[] = [];
  for (const event of events) (isUpcoming(event, nowMs) ? upcoming : past).push(event);
  const at = (event: AdminEventRecord) => Date.parse(event.startsAt);
  const tie = (a: AdminEventRecord, b: AdminEventRecord) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  upcoming.sort((a, b) => at(a) - at(b) || tie(a, b));
  past.sort((a, b) => (at(b) || 0) - (at(a) || 0) || tie(a, b));
  return { upcoming, past };
}

/** The date block of a row in Toronto time: 10月 / 24 / 周五, or Oct / 24 / Fri. */
/** 行首的多伦多时间日期块：10月 / 24 / 周五，或 Oct / 24 / Fri。 */
export function dateBlock(iso: string, locale: 'zh' | 'en'): { month: string; day: string; weekday: string } | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const w = wallClockAt(ms, NOTIFICATION_TIME_ZONE);
  return {
    month: locale === 'en' ? (MONTHS_EN[w.month - 1] ?? '') : `${w.month}月`,
    day: String(w.day),
    weekday: (locale === 'en' ? WEEKDAYS_EN : WEEKDAYS_ZH)[w.weekday] ?? '',
  };
}

/** The Toronto clock time, 18:30. */
/** 多伦多时间的钟点，例如 18:30。 */
export function clockText(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  const w = wallClockAt(ms, NOTIFICATION_TIME_ZONE);
  return `${String(w.hour).padStart(2, '0')}:${String(w.minute).padStart(2, '0')}`;
}

/** failed: some notice failed. scheduled: notices still to go out. notified: the widest reach of a sent notice. */
/** failed：有通知发送失败。scheduled：仍有通知待发送。notified：已发送的通知中覆盖人数最多的一条。 */
export type NoticeSummary = { kind: 'failed' } | { kind: 'scheduled'; count: number } | { kind: 'notified'; count: number | null };

/**
 * The chip of an event row. A failure comes first, since someone has to look at it; then what is still to go out;
 * then how many were reached. Members get every notice of an event, so the widest single notice is the number of
 * people notified, not the sum. Null when there are no notices or all were cancelled.
 * 活动行的标签。失败优先，因为需要有人处理；其次是仍待发送的通知；然后是覆盖了多少人。每位成员会收到同一活动的每条通知，因此通知人数取覆盖
 * 人数最多的一条，而不是总和。没有通知或全部已取消时为 null。
 */
export function noticeSummary(rows: readonly EventNotificationRow[] | undefined): NoticeSummary | null {
  const list = rows ?? [];
  if (list.some((row) => row.status === 'failed')) return { kind: 'failed' };
  const waiting = list.filter((row) => row.status === 'pending' || row.status === 'sending').length;
  if (waiting > 0) return { kind: 'scheduled', count: waiting };
  const sent = list.filter((row) => row.status === 'sent');
  if (sent.length === 0) return null;
  const counts = sent.map((row) => row.recipientCount).filter((count): count is number => typeof count === 'number');
  return { kind: 'notified', count: counts.length > 0 ? Math.max(...counts) : null };
}

export function noticeSummaryText(summary: NoticeSummary): Phrase {
  if (summary.kind === 'failed') return { zh: '通知失败', en: 'Notice failed' };
  if (summary.kind === 'scheduled') return { zh: `${summary.count} 条通知待发送`, en: `${plural(summary.count, 'notice', 'notices')} scheduled` };
  return summary.count === null ? { zh: '已通知', en: 'Notified' } : { zh: `已通知 ${summary.count} 人`, en: `Notified ${summary.count}` };
}

/** Notices deleting the event cancels: the ones still waiting. */
/** 删除活动会取消的通知：仍在等待发送的那些。 */
export function pendingNoticeCount(rows: readonly EventNotificationRow[] | undefined): number {
  return (rows ?? []).filter((row) => row.status === 'pending').length;
}

/** The create form's fields; times are datetime-local values read as Toronto time. */
/** 新建表单的字段；时间是按多伦多时间读取的 datetime-local 值。 */
export interface EventDraft {
  title: string;
  startsAt: string;
  location: string;
  description: string;
  notifyOnPublish: boolean;
  notifyMorningOf: boolean;
  customTimes: string[];
}

export function emptyEventDraft(): EventDraft {
  return { title: '', startsAt: '', location: '', description: '', notifyOnPublish: true, notifyMorningOf: true, customTimes: [] };
}

/**
 * The start of a copy: the same weekday and Toronto clock time as the original, in the first week far enough ahead
 * (a weekly meeting copied on Thursday lands on next Friday at 18:30). Empty for an invalid date.
 * 副本的开始时间：与原活动相同的星期几和多伦多钟点，取第一个足够靠后的那一周（周四复制每周例会，会落在下周五 18:30）。日期无效时为空。
 */
export function nextWeeklyStart(iso: string, nowMs: number): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  const w = wallClockAt(ms, NOTIFICATION_TIME_ZONE);
  for (let week = 0; week < 600; week += 1) {
    const at = wallTimeToUtcMs(w.year, w.month, w.day + week * 7, w.hour, w.minute, NOTIFICATION_TIME_ZONE);
    if (at - nowMs >= DUPLICATE_LEAD_MS) return isoToZonedLocal(new Date(at).toISOString(), NOTIFICATION_TIME_ZONE);
  }
  return '';
}

/** 复制为新活动: the title, place and description, at the next weekly slot; notices back to their defaults. */
/** 「复制为新活动」：标题、地点和说明，放在下一个每周同一时间；通知恢复为默认值。 */
export function duplicateDraft(event: AdminEventRecord, nowMs: number): EventDraft {
  return {
    ...emptyEventDraft(),
    title: event.title,
    startsAt: nextWeeklyStart(event.startsAt, nowMs),
    location: event.location ?? '',
    description: event.description ?? '',
  };
}

/**
 * Whether the server counts the event in upcomingEvents (starts_at >= now), so the overview count moves with a change
 * made here before the server confirms it.
 * 服务器是否把该活动计入 upcomingEvents（starts_at >= now），在这里做出的改动因此能在服务器确认之前调整管理首页的计数。
 */
export function countsAsUpcoming(event: Pick<AdminEventRecord, 'startsAt'>, nowMs: number): boolean {
  const start = Date.parse(event.startsAt);
  return !Number.isNaN(start) && start >= nowMs;
}
