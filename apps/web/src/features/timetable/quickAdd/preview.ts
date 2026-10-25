/**
 * Owner: T4, timetable quick add. The chips under the quick-add line and the assignment they turn into.
 * 维护者：T4，课表快速添加。快速添加输入框下方的标签，以及它们组成的作业。
 */
import type { AssignmentOffset, SaveAssignmentBody, TimetableLocale } from '@utmmsc/shared';
import { dueWhen } from '../model/formatDue';
import type { QuickAddParse } from './parse';

export type QuickAddChip =
  | { kind: 'title'; text: string; missing: boolean }
  | { kind: 'course'; text: string }
  | { kind: 'due'; text: string; assumed: boolean }
  | { kind: 'remind'; text: string };

const OFFSET_ZH: Readonly<Record<AssignmentOffset, string>> = {
  '1w': '1周',
  '2d': '2天',
  '1d': '1天',
  morning: '当天早上',
  '3h': '3小时',
  '1h': '1小时',
  '30m': '30分钟',
};

const OFFSET_EN: Readonly<Record<AssignmentOffset, string>> = {
  '1w': '1 week',
  '2d': '2 days',
  '1d': '1 day',
  morning: 'morning of',
  '3h': '3 h',
  '1h': '1 h',
  '30m': '30 min',
};

/** 提醒 1天 · 1小时, or 不提醒 when the defaults are empty. */
/** 提醒 1天 · 1小时；默认提醒为空时为「不提醒」。 */
export function remindText(offsets: readonly AssignmentOffset[], locale: TimetableLocale): string {
  const en = locale === 'en';
  if (offsets.length === 0) return en ? 'No reminders' : '不提醒';
  const names = offsets.map((offset) => (en ? OFFSET_EN : OFFSET_ZH)[offset]);
  return en ? `Remind ${names.join(' · ')}` : `提醒 ${names.join(' · ')}`;
}

/**
 * Title, course, deadline and reminders, in that order. A deadline the text did not name is marked assumed, so the
 * member sees 明天 23:59 was chosen for them.
 * 依次为标题、课程、截止时间和提醒。文字中没有写的截止时间标为推定，成员能看到「明天 23:59」是替他选的。
 */
export function quickAddChips(parse: QuickAddParse, offsets: readonly AssignmentOffset[], nowMs: number, locale: TimetableLocale): QuickAddChip[] {
  const en = locale === 'en';
  const chips: QuickAddChip[] = [
    parse.title ? { kind: 'title', text: parse.title, missing: false } : { kind: 'title', text: en ? 'Add a name' : '写上作业名称', missing: true },
  ];
  if (parse.courseCode) chips.push({ kind: 'course', text: parse.courseCode });
  chips.push({ kind: 'due', text: dueWhen(Date.parse(parse.dueAt), nowMs, locale), assumed: !parse.hasDate && !parse.hasTime });
  chips.push({ kind: 'remind', text: remindText(offsets, locale) });
  return chips;
}

/** The assignment to save, or null while there is no title. */
/** 要保存的作业；还没有标题时为 null。 */
export function quickAddBody(parse: QuickAddParse, offsets: readonly AssignmentOffset[], id: string): SaveAssignmentBody | null {
  if (!parse.title) return null;
  return { id, courseId: parse.courseId, title: parse.title, notes: null, dueAt: parse.dueAt, remindOffsets: [...offsets] };
}
