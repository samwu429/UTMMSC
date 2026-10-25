/**
 * Owner: T3, timetable web core. The half-height course sheet a tap on a block opens: code, name, this class's
 * time, kind and section, location and weeks; the notes; the course's assignments with + 添加作业; the 这门课上课
 * 提醒 switch; and 编辑 / 本次不上 (恢复上课) / 复制到其他天 / 删除. It reads the course from the store each time,
 * so it follows edits made from it and closes when the course is gone.
 * 维护者：T3，课表网页核心。点按方块打开的半屏课程面板：代码、名称、这节课的时间、类型与分组、地点和周次；备注；这门课的作业及「+ 添加作业」；
 * 「这门课上课提醒」开关；以及「编辑 / 本次不上（恢复上课）/ 复制到其他天 / 删除」。它每次都从 store 读取课程，因此会跟随从这里所做的修改，
 * 课程被删除时自动关闭。
 */
import { useEffect, useMemo, type ReactNode } from 'react';
import {
  formatClockRange,
  isoWeekday,
  shortCode,
  skipKey,
  type TimetableAssignment,
  type TimetableCourse,
  type TimetableLocale,
  type TimetableMeeting,
} from '@utmmsc/shared';
import { courseColor } from '../model/colors';
import { formatDue } from '../model/formatDue';
import { kindLabel, monthDay, weekRuleText, weekdayShort } from '../model/labels';
import { useTorontoNow } from '../model/useTorontoNow';
import { saveCourse, type TimetableView } from '../state/timetableStore';
import { bodyOfCourse } from './courseDraft';
import { SwitchRow } from '../ui/Cells';
import { HalfSheet } from '../ui/Sheet';

export interface CourseCardTarget {
  meetingId: string;
  date: string;
}

export interface CourseCardActions {
  onEdit: (course: TimetableCourse) => void;
  onToggleSkip: (course: TimetableCourse, meeting: TimetableMeeting, date: string, skipped: boolean) => void;
  onCopy: (course: TimetableCourse, meeting: TimetableMeeting) => void;
  onDelete: (course: TimetableCourse) => void;
  onAddAssignment: (course: TimetableCourse) => void;
  onOpenAssignment: (assignment: TimetableAssignment) => void;
}

export interface CourseCardProps extends CourseCardActions {
  target: CourseCardTarget;
  view: TimetableView;
  locale: TimetableLocale;
  onClose: () => void;
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 px-4 py-2.5">
      <span className="w-12 shrink-0 text-[15px] text-wx-meta">{label}</span>
      <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[15px] text-wx-ink">{children}</span>
    </div>
  );
}

export function CourseCard({ target, view, locale, onClose, onEdit, onToggleSkip, onCopy, onDelete, onAddAssignment, onOpenAssignment }: CourseCardProps) {
  const en = locale === 'en';
  const tr = (zh: string, enText: string) => (en ? enText : zh);
  const now = useTorontoNow();
  const found = useMemo(() => {
    for (const course of view.courses) {
      const meeting = course.meetings.find((m) => m.id === target.meetingId);
      if (meeting) return { course, meeting };
    }
    return null;
  }, [view.courses, target.meetingId]);

  useEffect(() => {
    if (!found) onClose();
  }, [found, onClose]);

  if (!found) return null;
  const { course, meeting } = found;
  const { fill, ink } = courseColor(course.color);
  const term = course.termId ? (view.terms.find((t) => t.id === course.termId) ?? null) : null;
  const skips = new Set(view.skips.map((skip) => skipKey(skip.onDate, skip.meetingId)));
  const single = skips.has(skipKey(target.date, meeting.id));
  const holiday = view.skips.find((skip) => skip.onDate === target.date && skip.meetingId === null) ?? null;
  const assignments = view.assignments.filter((a) => a.courseId === course.id && a.doneAt === null);
  const code = shortCode(course.code);
  const weekday = isoWeekday(target.date);

  return (
    <HalfSheet label={code} onClose={onClose}>
      <div className="bg-white px-4 pb-3 pt-1">
        <div className="flex items-start gap-3">
          <span aria-hidden className="mt-1 h-10 w-1.5 shrink-0 rounded-full" style={{ background: ink }} />
          <div className="min-w-0 flex-1">
            <h2 className="flex flex-wrap items-baseline gap-x-2 text-[20px] font-semibold text-wx-ink">
              {course.code}
              {single || holiday ? (
                <span className="rounded px-1.5 py-0.5 text-[12px] font-normal" style={{ background: fill, color: ink }}>
                  {tr('已停课', 'Skipped')}
                </span>
              ) : null}
            </h2>
            {course.title ? <p className="mt-0.5 text-[15px] text-wx-meta">{course.title}</p> : null}
          </div>
        </div>
      </div>
      <div className="mt-2 bg-white">
        <Line label={tr('时间', 'When')}>
          {`${weekdayShort(weekday, locale)} ${monthDay(target.date, locale)} · ${formatClockRange(meeting.startMin, meeting.endMin, locale)}`}
        </Line>
        <Line label={tr('类型', 'Kind')}>{meeting.section ? `${kindLabel(meeting.kind, locale)} · ${meeting.section}` : kindLabel(meeting.kind, locale)}</Line>
        {meeting.location ? <Line label={tr('地点', 'Room')}>{meeting.location}</Line> : null}
        <Line label={tr('周次', 'Weeks')}>{term ? `${weekRuleText(meeting, locale)} · ${term.name}` : tr('每周重复', 'Every week')}</Line>
        {holiday ? <Line label={tr('假日', 'Holiday')}>{holiday.label ?? tr('这天不上课', 'No classes this day')}</Line> : null}
        {course.notes ? <Line label={tr('备注', 'Notes')}>{course.notes}</Line> : null}
      </div>

      <section className="mt-2 bg-white" aria-label={tr('作业', 'Assignments')}>
        <h3 className="px-4 pb-1 pt-3 text-[13px] text-wx-meta">{tr('作业', 'Assignments')}</h3>
        {assignments.map((assignment) => {
          const due = formatDue(assignment.dueAt, now, locale);
          return (
            <button key={assignment.id} type="button" onClick={() => onOpenAssignment(assignment)} className="flex min-h-12 w-full items-center gap-3 px-4 text-left active:bg-wx-pressed">
              <span className="min-w-0 flex-1 truncate text-[15px] text-wx-ink">{assignment.title}</span>
              <span className={`shrink-0 text-[13px] ${due.overdue ? 'text-wx-red' : 'text-wx-meta'}`}>{`${due.when} · ${due.relative}`}</span>
            </button>
          );
        })}
        <button type="button" onClick={() => onAddAssignment(course)} className="flex min-h-12 w-full items-center px-4 text-left text-[15px] font-medium text-wx-link active:bg-wx-pressed">
          {tr('+ 添加作业', '+ Add assignment')}
        </button>
      </section>

      <div className="mt-2 bg-white">
        <SwitchRow label={tr('这门课上课提醒', 'Remind me before this class')} checked={course.remind} onChange={(remind) => saveCourse({ ...bodyOfCourse(course), remind })} />
      </div>

      <div className="mt-2 grid grid-cols-4 bg-white">
        {[
          { label: tr('编辑', 'Edit'), run: () => onEdit(course), danger: false, disabled: false },
          {
            label: single ? tr('恢复上课', 'Restore') : tr('本次不上', 'Skip this class'),
            run: () => onToggleSkip(course, meeting, target.date, !single),
            danger: false,
            disabled: holiday !== null && !single,
          },
          { label: tr('复制到其他天', 'Copy to days'), run: () => onCopy(course, meeting), danger: false, disabled: false },
          { label: tr('删除', 'Delete'), run: () => onDelete(course), danger: true, disabled: false },
        ].map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={action.run}
            disabled={action.disabled}
            className={`flex min-h-14 items-center justify-center px-1 text-center text-[14px] leading-tight active:bg-wx-pressed disabled:opacity-40 ${action.danger ? 'text-wx-red' : 'text-wx-ink'}`}
          >
            {action.label}
          </button>
        ))}
      </div>
    </HalfSheet>
  );
}
