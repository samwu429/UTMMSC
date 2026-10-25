/**
 * Owner: T3, timetable web core. The week grid's model: one week of classes (skipped ones included, so they show
 * hatched), side-by-side lanes for overlapping blocks, and the overlap notice of the course sheet.
 * 维护者：T3，课表网页核心。周课表的模型：一周的课（包括停课的，以便显示为斜线），重叠方块并排的分栏，以及课程表单中的时间重叠提示。
 */
import {
  addDays,
  isoWeekday,
  occursOn,
  type SaveCourseBody,
  type SkipIndex,
  type TimetableCourse,
  type TimetableData,
  type TimetableMeeting,
  type TimetableOccurrence,
  type TimetableTerm,
} from '@utmmsc/shared';
import { indexTimetable, occurrencesOn } from './occurrences';

/** A class in the visible week. skipped: a holiday or 本次不上 removed it, and it shows as 已停课. */
/** 当前显示的一周中的一节课。skipped：被假日或「本次不上」取消，显示为「已停课」。 */
export interface WeekOccurrence extends TimetableOccurrence {
  skipped: boolean;
  /** Overlaps another class that day, so the block shows the ! badge. */
  /** 与当天另一节课时间重叠，方块显示 ! 标记。 */
  conflict: boolean;
}

function overlaps(a: { startMin: number; endMin: number }, b: { startMin: number; endMin: number }): boolean {
  return a.startMin < b.endMin && b.startMin < a.endMin;
}

/** Every class of the Monday-to-Sunday week starting on `monday`, in start order. */
/** 从 `monday` 开始的周一到周日这一周的每一节课，按开始时间排序。 */
export function weekOccurrences(data: TimetableData, monday: string): WeekOccurrence[] {
  const index = indexTimetable(data);
  const out: WeekOccurrence[] = [];
  for (let day = 0; day < 7; day += 1) {
    const classes = occurrencesOn(index, addDays(monday, day), true);
    for (const occurrence of classes) {
      // A skipped class neither has nor causes a conflict: it does not take place.
      // 停课的课既不会有冲突，也不会造成冲突：它并不上。
      const conflict = !occurrence.skipped && classes.some((other) => other !== occurrence && !other.skipped && overlaps(other.meeting, occurrence.meeting));
      out.push({ course: occurrence.course, meeting: occurrence.meeting, date: occurrence.date, startMs: occurrence.startMs, endMs: occurrence.endMs, skipped: occurrence.skipped, conflict });
    }
  }
  return out;
}

export interface LaneItem {
  key: string;
  startMin: number;
  endMin: number;
}

/** lane is the 0-based column inside a cluster of overlapping blocks; lanes is how many columns that cluster has. */
/** lane 是重叠方块组内从 0 开始的列号；lanes 是该组的列数。 */
export interface LanePlacement {
  lane: number;
  lanes: number;
}

/**
 * Greedy lanes, as calendar week views place overlapping blocks side by side: blocks are taken by start (longer
 * first), each goes into the first lane that is free by its start, and a cluster of blocks that overlap one another,
 * directly or through others, shares one lane count.
 * 贪心分栏，与日历周视图并排放置重叠方块的方式一致：按开始时间（较长的优先）依次处理，每个方块放进在其开始时已空出的第一列；
 * 直接或间接相互重叠的一组方块共用同一个列数。
 */
export function lanes(items: readonly LaneItem[]): Map<string, LanePlacement> {
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const out = new Map<string, LanePlacement>();
  let cluster: { key: string; lane: number }[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = Number.NEGATIVE_INFINITY;
  const close = () => {
    for (const { key, lane } of cluster) out.set(key, { lane, lanes: laneEnds.length });
    cluster = [];
    laneEnds = [];
    clusterEnd = Number.NEGATIVE_INFINITY;
  };
  for (const item of sorted) {
    if (item.startMin >= clusterEnd) close();
    let lane = laneEnds.findIndex((end) => end <= item.startMin);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(item.endMin);
    } else {
      laneEnds[lane] = item.endMin;
    }
    cluster.push({ key: item.key, lane });
    clusterEnd = Math.max(clusterEnd, item.endMin);
  }
  close();
  return out;
}

/** One overlap between a meeting of the course being edited and a meeting of another course. */
/** 正在编辑的课程的某个上课时间与另一门课程的上课时间之间的一处重叠。 */
export interface TimetableConflict {
  meetingId: string;
  other: { course: TimetableCourse; meeting: TimetableMeeting };
}

const NO_SKIPS: SkipIndex = new Set();

/**
 * The dates a meeting of a term-bound course takes place (single skips aside), or null for a term-less course,
 * which runs every week.
 * 属于学期的课程的某个上课时间所上的日期（不计单次停课）；不属于学期的课程每周都上，返回 null。
 */
function termDates(meeting: TimetableMeeting, term: TimetableTerm | null): Set<string> | null {
  if (!term) return null;
  const dates = new Set<string>();
  const shift = (meeting.weekday - isoWeekday(term.startsOn) + 7) % 7;
  for (let date = addDays(term.startsOn, shift); date <= term.endsOn; date = addDays(date, 7)) {
    if (occursOn(meeting, term, NO_SKIPS, date)) dates.add(date);
  }
  return dates;
}

function shareADate(a: Set<string> | null, b: Set<string> | null): boolean {
  if (a === null && b === null) return true;
  if (a === null) return (b?.size ?? 0) > 0;
  if (b === null) return a.size > 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const date of small) if (large.has(date)) return true;
  return false;
}

/**
 * Overlaps of a draft course with the other courses: same weekday, overlapping times, overlapping term dates and
 * intersecting week sets (odd never conflicts with even). Never blocks saving.
 * 草稿课程与其他课程的时间重叠：同一天、时间重叠、学期日期重叠且周次相交（单周与双周不会冲突）。从不阻止保存。
 */
export function findConflicts(
  draft: Pick<SaveCourseBody, 'id' | 'termId' | 'meetings'>,
  courses: readonly TimetableCourse[],
  terms: readonly TimetableTerm[],
): TimetableConflict[] {
  const byId = new Map(terms.map((term) => [term.id, term]));
  const draftTerm = draft.termId === null ? null : byId.get(draft.termId);
  // A draft whose term is gone never takes place, so it overlaps nothing.
  // 学期已不存在的草稿不会上课，因此不与任何课重叠。
  if (draftTerm === undefined) return [];
  const out: TimetableConflict[] = [];
  const dateCache = new Map<string, Set<string> | null>();
  const datesOf = (meeting: TimetableMeeting, term: TimetableTerm | null, key: string) => {
    if (!dateCache.has(key)) dateCache.set(key, termDates(meeting, term));
    return dateCache.get(key) ?? null;
  };
  draft.meetings.forEach((meeting, position) => {
    for (const course of courses) {
      if (course.id === draft.id) continue;
      const term = course.termId === null ? null : byId.get(course.termId);
      if (term === undefined) continue;
      for (const other of course.meetings) {
        if (other.weekday !== meeting.weekday || !overlaps(meeting, other)) continue;
        if (!shareADate(datesOf(meeting, draftTerm, `d${position}`), datesOf(other, term, `o${other.id}`))) continue;
        out.push({ meetingId: meeting.id, other: { course, meeting: other } });
      }
    }
  });
  return out;
}
