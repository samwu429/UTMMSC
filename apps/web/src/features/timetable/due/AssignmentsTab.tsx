/**
 * Owner: T3, timetable web core. The 作业 tab (timetable-final.md section 11): quick add at the top, then 已逾期
 * (red) / 今天 / 明天 / 本周 / 以后, and 已完成 collapsed with 清除已完成. A row shows the course colour, the title, the
 * course and due time, and how long is left; its tick circle completes it at once, with 已完成 · 撤销 for 5 s.
 * 维护者：T3，课表网页核心。「作业」标签（timetable-final.md 第 11 节）：顶部是快速添加，然后是已逾期（红色）/ 今天 / 明天 / 本周 / 以后，
 * 以及折叠的已完成（带「清除已完成」）。每一行显示课程颜色、作业名称、课程和截止时间，以及剩余时间；点按勾选圆圈立即完成，并显示 5 秒的
 * 「已完成 · 撤销」。
 */
import { Suspense, lazy, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { shortCode, type SaveAssignmentBody, type TimetableAssignment, type TimetableCourse, type TimetableLocale } from '@utmmsc/shared';
import { useConfirm } from '../../../shared/ui/confirm';
import { courseColor } from '../model/colors';
import { formatDue } from '../model/formatDue';
import { useTorontoNow } from '../model/useTorontoNow';
import { deleteAssignment, saveAssignment, setAssignmentDone, type TimetableView } from '../state/timetableStore';
import { ChevronDownIcon, TickCircle } from '../ui/icons';
import { UndoBar, useTickGuard, useUndoOffer } from '../ui/UndoBar';
import { dueSections, type DueSectionKey } from './sections';

const QuickAddBar = lazy(() => import('../quickAdd/QuickAddBar'));

function sectionTitle(key: DueSectionKey, tr: (zh: string, en: string) => string): string {
  switch (key) {
    case 'overdue':
      return tr('已逾期', 'Overdue');
    case 'today':
      return tr('今天', 'Today');
    case 'tomorrow':
      return tr('明天', 'Tomorrow');
    case 'week':
      return tr('本周', 'This week');
    case 'later':
      return tr('以后', 'Later');
    case 'done':
      return tr('已完成', 'Done');
  }
}

interface RowProps {
  assignment: TimetableAssignment;
  course: TimetableCourse | undefined;
  nowMs: number;
  locale: TimetableLocale;
  pending: boolean;
  flash: boolean;
  onOpen: (assignment: TimetableAssignment) => void;
  onTick: (assignment: TimetableAssignment) => void;
}

const AssignmentRow = memo(function AssignmentRow({ assignment, course, nowMs, locale, pending, flash, onOpen, onTick }: RowProps) {
  const en = locale === 'en';
  const done = assignment.doneAt !== null;
  const due = formatDue(assignment.dueAt, nowMs, locale);
  const ink = course ? courseColor(course.color).ink : '#B8B8B8';
  const meta = course ? `${shortCode(course.code)} · ${due.when}` : due.when;
  return (
    <li data-assignment={assignment.id} className={`flex items-stretch bg-white ${flash ? 'wx-flash' : ''}`}>
      <button
        type="button"
        onClick={() => onTick(assignment)}
        aria-label={done ? (en ? `Mark “${assignment.title}” as not done` : `把「${assignment.title}」标为未完成`) : en ? `Mark “${assignment.title}” as done` : `完成「${assignment.title}」`}
        className={`flex w-14 shrink-0 items-center justify-center active:opacity-60 ${done ? 'text-brand-700' : 'text-stone-400'}`}
      >
        <TickCircle done={done} />
      </button>
      <button type="button" onClick={() => onOpen(assignment)} className="flex min-h-[60px] min-w-0 flex-1 items-center gap-3 py-2 pr-4 text-left active:bg-wx-pressed">
        <span aria-hidden className="h-9 w-1 shrink-0 rounded-full" style={{ background: ink }} />
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-[16px] ${done ? 'text-wx-meta line-through' : 'text-wx-ink'}`}>{assignment.title}</span>
          <span className="mt-0.5 block truncate text-[13px] text-wx-meta">{meta}</span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-0.5">
          {!done ? <span className={`text-[13px] ${due.overdue ? 'text-wx-red' : due.dueSoon ? 'font-medium text-amber-800' : 'text-wx-meta'}`}>{due.relative}</span> : null}
          {pending ? <span className="text-[11px] text-wx-meta">{en ? 'Not synced' : '待同步'}</span> : null}
        </span>
      </button>
    </li>
  );
});

export interface AssignmentsTabProps {
  view: TimetableView;
  locale: TimetableLocale;
  flashId: string | null;
  onAdd: () => void;
  onOpen: (assignment: TimetableAssignment) => void;
}

export function AssignmentsTab({ view, locale, flashId, onAdd, onOpen }: AssignmentsTabProps) {
  const en = locale === 'en';
  const tr = (zh: string, enText: string) => (en ? enText : zh);
  const confirm = useConfirm();
  const now = useTorontoNow();
  const undo = useUndoOffer();
  const tickAllowed = useTickGuard();
  const [showDone, setShowDone] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const sections = useMemo(() => dueSections(view.assignments, now), [view.assignments, now]);
  const courses = useMemo(() => new Map(view.courses.map((course) => [course.id, course])), [view.courses]);
  const { show } = undo;

  const tick = useCallback(
    (assignment: TimetableAssignment) => {
      // A ticked row leaves its section and the next one moves up under the finger, so a second tap right after is ignored.
      // 勾选的行会离开所在分组，下一行随即移到手指下方，所以紧接着的第二下点按会被忽略。
      if (!tickAllowed()) return;
      if (assignment.doneAt !== null) {
        setAssignmentDone(assignment.id, false);
        return;
      }
      setAssignmentDone(assignment.id, true);
      show(en ? 'Done' : '已完成', () => setAssignmentDone(assignment.id, false));
    },
    [show, en, tickAllowed],
  );

  useEffect(() => {
    if (!flashId) return;
    const flashed = view.assignments.find((a) => a.id === flashId);
    if (flashed?.doneAt) setShowDone(true);
    const frame = requestAnimationFrame(() => {
      listRef.current?.querySelector(`[data-assignment="${flashId}"]`)?.scrollIntoView({ block: 'center' });
    });
    return () => cancelAnimationFrame(frame);
  }, [flashId, view.assignments]);

  async function clearDone(items: readonly TimetableAssignment[]) {
    const ok = await confirm({ title: tr(`清除 ${items.length} 项已完成的作业？`, `Clear ${items.length} done ${items.length === 1 ? 'assignment' : 'assignments'}?`), confirmLabel: tr('清除', 'Clear'), danger: true });
    if (!ok) return;
    for (const item of items) deleteAssignment(item.id);
  }

  const open = sections.filter((section) => section.key !== 'done');
  const done = sections.find((section) => section.key === 'done');

  return (
    <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-wx-canvas" style={{ paddingBottom: 'calc(var(--safe-bottom) + 5rem)' }}>
      <Suspense fallback={null}>
        <QuickAddBar onAdd={(body: SaveAssignmentBody) => saveAssignment(body)} />
      </Suspense>
      {open.length === 0 && !done ? (
        <div className="flex flex-col items-center px-8 pt-16 text-center">
          <p className="text-[15px] leading-6 text-wx-meta">{tr('还没有作业。添加作业，截止前提醒你。', 'No assignments yet. Add one and get reminded before it is due.')}</p>
          <button type="button" onClick={onAdd} className="mt-4 min-h-11 rounded-lg bg-brand-800 px-5 text-[15px] font-medium text-white active:bg-brand-900">
            {tr('添加作业', 'Add assignment')}
          </button>
        </div>
      ) : null}
      {open.length === 0 && done ? <p className="px-4 pt-6 text-center text-[15px] text-wx-meta">{tr('作业都完成了', 'All done')}</p> : null}
      {open.map((section) => (
        <section key={section.key} aria-labelledby={`tt-due-${section.key}`}>
          <h3 id={`tt-due-${section.key}`} className={`px-4 pb-1.5 pt-4 text-[13px] leading-5 ${section.key === 'overdue' ? 'font-medium text-wx-red' : 'text-wx-meta'}`}>
            {`${sectionTitle(section.key, tr)} · ${section.items.length}`}
          </h3>
          <ul className="divide-y-[0.5px] divide-wx-line">
            {section.items.map((assignment) => (
              <AssignmentRow
                key={assignment.id}
                assignment={assignment}
                course={assignment.courseId ? courses.get(assignment.courseId) : undefined}
                nowMs={now}
                locale={locale}
                pending={view.pendingIds.has(assignment.id)}
                flash={flashId === assignment.id}
                onOpen={onOpen}
                onTick={tick}
              />
            ))}
          </ul>
        </section>
      ))}
      {done ? (
        <section aria-labelledby="tt-due-done" className="mt-4">
          <div className="flex items-center bg-white">
            <button type="button" id="tt-due-done" aria-expanded={showDone} onClick={() => setShowDone((value) => !value)} className="flex min-h-12 flex-1 items-center gap-2 px-4 text-left active:bg-wx-pressed">
              <span className="text-[15px] text-wx-ink">{`${sectionTitle('done', tr)} · ${done.items.length}`}</span>
              <ChevronDownIcon className={`h-4 w-4 text-stone-400 transition-transform motion-reduce:transition-none ${showDone ? 'rotate-180' : ''}`} />
            </button>
            {showDone ? (
              <button type="button" onClick={() => void clearDone(done.items)} className="min-h-12 px-4 text-[14px] text-wx-red active:opacity-60">
                {tr('清除已完成', 'Clear done')}
              </button>
            ) : null}
          </div>
          {showDone ? (
            <ul className="divide-y-[0.5px] divide-wx-line border-t-[0.5px] border-wx-line">
              {done.items.map((assignment) => (
                <AssignmentRow
                  key={assignment.id}
                  assignment={assignment}
                  course={assignment.courseId ? courses.get(assignment.courseId) : undefined}
                  nowMs={now}
                  locale={locale}
                  pending={view.pendingIds.has(assignment.id)}
                  flash={flashId === assignment.id}
                  onOpen={onOpen}
                  onTick={tick}
                />
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
      <UndoBar offer={undo.offer} onDismiss={undo.dismiss} />
    </div>
  );
}
