/**
 * Owner: T3, timetable web core. The 作业 tab's sections and the tab badge, in Toronto time: 已逾期 / 今天 / 明天 /
 * 本周 / 以后 / 已完成, each sorted by due time. The badge counts overdue items plus items due within 48 hours.
 * 维护者：T3，课表网页核心。「作业」标签的分组和标签上的数字，按多伦多时间：已逾期 / 今天 / 明天 / 本周 / 以后 / 已完成，
 * 每组按截止时间排序。数字为已逾期的数量加上 48 小时内截止的数量。
 */
import { addDays, isoWeekday, torontoDateOf, type TimetableAssignment } from '@utmmsc/shared';

export type DueSectionKey = 'overdue' | 'today' | 'tomorrow' | 'week' | 'later' | 'done';

export interface DueSection {
  key: DueSectionKey;
  items: TimetableAssignment[];
}

const SOON_MS = 48 * 3_600_000;
/** Done items stay listed this long; the server stops sending them after the same time. */
/** 已完成的作业保留这么久；服务器在同样的时间之后也不再发送它们。 */
export const DONE_KEPT_MS = 30 * 86_400_000;

function byDue(a: TimetableAssignment, b: TimetableAssignment): number {
  return Date.parse(a.dueAt) - Date.parse(b.dueAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** The sections that have items, in their fixed order. 本周 runs to this Sunday, after 明天. */
/** 有内容的分组，按固定顺序。「本周」在「明天」之后，直到本周日。 */
export function dueSections(assignments: readonly TimetableAssignment[], nowMs: number): DueSection[] {
  const today = torontoDateOf(nowMs);
  const tomorrow = addDays(today, 1);
  const sunday = addDays(today, 7 - isoWeekday(today));
  const groups: Record<DueSectionKey, TimetableAssignment[]> = { overdue: [], today: [], tomorrow: [], week: [], later: [], done: [] };
  for (const assignment of assignments) {
    const due = Date.parse(assignment.dueAt);
    if (Number.isNaN(due)) continue;
    if (assignment.doneAt !== null) {
      const doneAt = Date.parse(assignment.doneAt);
      if (Number.isNaN(doneAt) || nowMs - doneAt <= DONE_KEPT_MS) groups.done.push(assignment);
      continue;
    }
    if (due < nowMs) {
      groups.overdue.push(assignment);
      continue;
    }
    const date = torontoDateOf(due);
    if (date === today) groups.today.push(assignment);
    else if (date === tomorrow) groups.tomorrow.push(assignment);
    else if (date <= sunday) groups.week.push(assignment);
    else groups.later.push(assignment);
  }
  const order: DueSectionKey[] = ['overdue', 'today', 'tomorrow', 'week', 'later', 'done'];
  return order.filter((key) => groups[key].length > 0).map((key) => ({ key, items: groups[key].sort(byDue) }));
}

export interface DueCounts {
  overdue: number;
  /** Due within 48 hours and not yet overdue. */
  /** 48 小时内截止且尚未逾期。 */
  soon: number;
}

export function dueCounts(assignments: readonly Pick<TimetableAssignment, 'dueAt' | 'doneAt'>[], nowMs: number): DueCounts {
  let overdue = 0;
  let soon = 0;
  for (const assignment of assignments) {
    if (assignment.doneAt !== null) continue;
    const due = Date.parse(assignment.dueAt);
    if (Number.isNaN(due)) continue;
    if (due < nowMs) overdue += 1;
    else if (due - nowMs <= SOON_MS) soon += 1;
  }
  return { overdue, soon };
}

/** The 作业 tab badge: overdue items plus items due within 48 hours. */
/** 「作业」标签上的数字：已逾期的数量加上 48 小时内截止的数量。 */
export function dueBadge(assignments: readonly Pick<TimetableAssignment, 'dueAt' | 'doneAt'>[], nowMs: number): number {
  const counts = dueCounts(assignments, nowMs);
  return counts.overdue + counts.soon;
}
