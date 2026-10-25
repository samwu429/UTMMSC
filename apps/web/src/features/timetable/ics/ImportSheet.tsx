/**
 * Owner: T4, timetable import and export. 导入日历文件 (timetable-final.md section 14), loaded lazily by the week view
 * and the home card: pick a .ics file, which is read on this device only; a preview with checkboxes of the terms,
 * courses and deadlines it would add, with times outside 09:00-21:00 flagged and fixed before they can be ticked;
 * then one POST /import. Online only.
 * 维护者：T4，课表导入导出。「导入日历文件」（timetable-final.md 第 14 节），由周课表和首页卡片按需加载：选择 .ics 文件，只在这台设备上读取；
 * 预览将要添加的学期、课程和截止时间并带勾选框，不在 09:00-21:00 之间的时间会被标出，修改后才能勾选；然后一次 POST /import。仅限联网使用。
 */
import { useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { formatClock, type TimetableLocale } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { useLocaleStore, useTr } from '../../../shared/i18n/locale';
import { useBackToClose } from '../../../shared/ui/overlayHistory';
import { toast } from '../../../shared/ui/toast';
import { WxSpinner } from '../../../shared/ui/WxSpinner';
import { newTimetableId } from '../model/ids';
import { importAll, useTimetableView } from '../state/timetableStore';
import { useEscape } from '../ui/Sheet';
import {
  ICS_MAX_BYTES,
  assignmentLine,
  endAfterStartChange,
  endTimeOptions,
  fileProblemText,
  ignoredText,
  importButtonText,
  importDoneText,
  importProblemText,
  meetingLine,
  meetingProblemText,
  planIsEmpty,
  readCalendarText,
  startTimeOptions,
  termLine,
} from './importCopy';
import { buildImportBody, defaultChoices, planImport, type ImportChoices, type ImportCourseDraft, type ImportPlan } from './plan';

export interface ImportSheetProps {
  onClose: () => void;
}

type Stage =
  | { kind: 'pick'; error: string | null }
  | { kind: 'reading' }
  | { kind: 'preview'; fileName: string; plan: ImportPlan; choices: ImportChoices; nowMs: number };

function subscribeOnline(listener: () => void): () => void {
  window.addEventListener('online', listener);
  window.addEventListener('offline', listener);
  return () => {
    window.removeEventListener('online', listener);
    window.removeEventListener('offline', listener);
  };
}

function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine !== false,
    () => true,
  );
}

function CloseGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

function CalendarGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-10 w-10 text-brand-700" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M3.5 10h17M8 3v4M16 3v4M8 14h3M8 17h6" />
    </svg>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-5">
      <h3 className="px-4 pb-1.5 text-[13px] font-medium text-wx-meta">{title}</h3>
      <div className="divide-y divide-wx-line border-y border-wx-line bg-white">{children}</div>
    </section>
  );
}

function TimeSelect({ value, options, label, locale, onChange }: { value: number; options: number[]; label: string; locale: TimetableLocale; onChange: (minute: number) => void }) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
      className="min-h-11 rounded-lg border border-stone-300 bg-white px-2 text-[15px] text-wx-ink"
    >
      {options.map((minute) => (
        <option key={minute} value={minute}>
          {formatClock(minute, locale)}
        </option>
      ))}
    </select>
  );
}

function CourseCard({
  course,
  termName,
  choices,
  locale,
  onChoices,
}: {
  course: ImportCourseDraft;
  termName: string | null;
  choices: ImportChoices;
  locale: TimetableLocale;
  onChoices: (update: (draft: ImportChoices) => void) => void;
}) {
  const tr = useTr();
  const codeId = useId();
  const choice = choices.courses[course.id] ?? { include: false, code: course.code };
  const notes: string[] = [];
  if (course.duplicateOf) notes.push(tr(`课表中已有 ${course.duplicateOf}`, `${course.duplicateOf} is already in your timetable`));
  else if (!course.recognized) notes.push(tr('没有课程代码，可能不是课程', 'No course code; it may not be a class'));

  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={choice.include}
          onChange={(event) =>
            onChoices((draft) => {
              draft.courses[course.id] = { ...choice, include: event.target.checked };
            })
          }
          aria-labelledby={codeId}
          className="h-5 w-5 shrink-0 accent-brand-800"
        />
        <div className="min-w-0 flex-1">
          <label id={codeId} className="sr-only" htmlFor={`${codeId}-code`}>
            {tr(`课程代码 ${choice.code}`, `Course code ${choice.code}`)}
          </label>
          <input
            id={`${codeId}-code`}
            value={choice.code}
            maxLength={40}
            autoCapitalize="characters"
            spellCheck={false}
            onChange={(event) => {
              const code = event.target.value;
              onChoices((draft) => {
                draft.courses[course.id] = { ...choice, code };
              });
            }}
            className="w-full min-w-0 rounded-md border border-transparent bg-transparent px-1 py-1 text-[16px] font-semibold uppercase text-wx-ink focus:border-stone-300 focus:bg-white focus:outline-none"
          />
          <p className="truncate px-1 text-[13px] text-wx-meta">
            {[course.title, termName ?? tr('不属于学期 · 每周重复', 'No term · every week')].filter(Boolean).join(' · ')}
          </p>
          {notes.map((note) => (
            <p key={note} className="px-1 text-[13px] text-amber-700">
              {note}
            </p>
          ))}
        </div>
      </div>
      {choice.include ? (
        <ul className="mt-2 space-y-2 pl-8">
          {course.meetings.map((meeting) => {
            const pick = choices.meetings[meeting.id] ?? { include: false, startMin: meeting.suggestedStart, endMin: meeting.suggestedEnd };
            const setPick = (next: Partial<typeof pick>) =>
              onChoices((draft) => {
                draft.meetings[meeting.id] = { ...pick, ...next };
              });
            const lineId = `${codeId}-${meeting.id}`;
            return (
              <li key={meeting.id} className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={pick.include}
                  onChange={(event) => setPick({ include: event.target.checked })}
                  aria-labelledby={lineId}
                  className="mt-1 h-4 w-4 shrink-0 accent-brand-800"
                />
                <div className="min-w-0 flex-1">
                  <p id={lineId} className="text-[14px] leading-snug text-wx-ink">
                    {meetingLine(meeting, meeting.problem ? meeting.startMin : pick.startMin, meeting.problem ? meeting.endMin : pick.endMin, locale)}
                  </p>
                  {meeting.problem ? (
                    <div className="mt-1">
                      <p className="text-[13px] text-wx-red">{meetingProblemText(meeting.problem, locale)}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[14px] text-wx-meta">
                        <span>{tr('改为', 'Change to')}</span>
                        <TimeSelect
                          value={pick.startMin}
                          options={startTimeOptions()}
                          label={tr('开始时间', 'Start time')}
                          locale={locale}
                          onChange={(startMin) => setPick({ startMin, endMin: endAfterStartChange(pick.startMin, pick.endMin, startMin) })}
                        />
                        <span aria-hidden>–</span>
                        <TimeSelect value={pick.endMin} options={endTimeOptions(pick.startMin)} label={tr('结束时间', 'End time')} locale={locale} onChange={(endMin) => setPick({ endMin })} />
                      </div>
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Full-screen on phones with a sticky import button; the system back gesture, Escape and 取消 close it. It is
 * portaled to body at z-[57], above FullSheet (55) and a raised FullSheet (56), so it opens on top of 课表设置
 * instead of underneath it, and below menus (60), confirms (70) and toasts (80).
 * 在手机上全屏显示，导入按钮固定在底部；系统返回手势、Escape 和「取消」都会关闭它。它通过 portal 渲染到 body，层级为 z-[57]，
 * 高于 FullSheet（55）和抬高的 FullSheet（56），因此会在「课表设置」之上打开，而不是被压在下面；
 * 并低于菜单（60）、确认框（70）和提示（80）。
 */
export default function ImportSheet({ onClose }: ImportSheetProps): JSX.Element | null {
  const tr = useTr();
  const locale = useLocaleStore((state) => state.locale);
  const view = useTimetableView();
  const online = useOnline();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const closeRef = useRef(onClose);
  const readSeq = useRef(0);
  const [stage, setStage] = useState<Stage>({ kind: 'pick', error: null });
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  useLayoutEffect(() => {
    closeRef.current = onClose;
  });
  useBackToClose(onClose);
  useEscape(onClose, dialogRef);

  // Focus moves to the title, and goes back to whatever opened the sheet (such as the row in 课表设置) on close.
  // 焦点移到标题上；关闭时回到打开面板的控件（例如「课表设置」中的那一行）。
  useLayoutEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    headingRef.current?.focus({ preventScroll: true });
    return () => {
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  const built = useMemo(() => (stage.kind === 'preview' ? buildImportBody(stage.plan, stage.choices, view) : null), [stage, view]);

  async function readFile(file: File) {
    const seq = (readSeq.current += 1);
    setSendError(null);
    if (file.size > ICS_MAX_BYTES) {
      setStage({ kind: 'pick', error: fileProblemText('too_large', locale) });
      return;
    }
    setStage({ kind: 'reading' });
    let text: string;
    try {
      text = await file.text();
    } catch {
      if (seq === readSeq.current) setStage({ kind: 'pick', error: fileProblemText('unreadable', locale) });
      return;
    }
    if (seq !== readSeq.current) return;
    const read = readCalendarText(text);
    if (!read.ok) {
      setStage({ kind: 'pick', error: fileProblemText(read.problem, locale) });
      return;
    }
    const nowMs = Date.now();
    const plan = planImport(read.calendar, {
      terms: view.terms,
      courses: view.courses,
      skips: view.skips,
      assignments: view.assignments,
      settings: view.settings,
      nowMs,
      locale,
      newId: newTimetableId,
    });
    if (planIsEmpty(plan)) {
      setStage({ kind: 'pick', error: [fileProblemText('nothing', locale), ignoredText(plan.ignored, locale)].filter(Boolean).join(' ') });
      return;
    }
    setStage({ kind: 'preview', fileName: file.name, plan, choices: defaultChoices(plan), nowMs });
  }

  function updateChoices(update: (draft: ImportChoices) => void) {
    setStage((current) => {
      if (current.kind !== 'preview') return current;
      const draft: ImportChoices = {
        courses: { ...current.choices.courses },
        meetings: { ...current.choices.meetings },
        terms: { ...current.choices.terms },
        assignments: { ...current.choices.assignments },
      };
      update(draft);
      return { ...current, choices: draft };
    });
  }

  async function submit() {
    if (!built || built.problems.length > 0 || sending) return;
    setSending(true);
    setSendError(null);
    try {
      await importAll(built.body);
      toast(importDoneText(built.counts, locale), { ms: 2000 });
      closeRef.current();
    } catch (error) {
      setSendError(errorMessage(error));
    } finally {
      setSending(false);
    }
  }

  const nothingChosen = !built || built.counts.courses + built.counts.assignments === 0;
  const canImport = online && !sending && !nothingChosen && (built?.problems.length ?? 1) === 0;
  const termName = (termId: string | null): string | null => {
    if (termId === null) return null;
    if (stage.kind === 'preview' && termId in stage.choices.terms) return stage.choices.terms[termId] ?? null;
    return view.terms.find((term) => term.id === termId)?.name ?? null;
  };

  return createPortal(
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className="fixed inset-0 z-[57] flex flex-col bg-wx-canvas" style={{ paddingTop: 'var(--safe-top)' }}>
      <header className="relative flex min-h-12 shrink-0 items-center border-b-[0.5px] border-wx-line bg-wx-bar px-1">
        <button type="button" onClick={onClose} className="flex min-h-11 min-w-11 items-center justify-center rounded-lg px-2 text-wx-ink active:bg-wx-pressed" aria-label={tr('取消', 'Cancel')}>
          <CloseGlyph />
        </button>
        <h2 id={titleId} ref={headingRef} tabIndex={-1} className="pointer-events-none absolute inset-x-14 truncate text-center text-[17px] font-semibold text-wx-ink outline-none">
          {tr('导入日历文件', 'Import a calendar file')}
        </h2>
        {stage.kind === 'preview' ? (
          <button type="button" onClick={() => inputRef.current?.click()} className="ml-auto min-h-11 rounded-lg px-3 text-[15px] text-wx-link active:bg-wx-pressed">
            {tr('换一个', 'Other file')}
          </button>
        ) : null}
      </header>

      <input
        ref={inputRef}
        type="file"
        accept=".ics,text/calendar"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void readFile(file);
        }}
      />

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4">
        {stage.kind !== 'preview' ? (
          <div className="flex flex-col items-center px-6 pt-12 text-center">
            <CalendarGlyph />
            <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-wx-ink">
              {tr(
                '选择 .ics 日历文件，支持 Google、Outlook、Apple 日历和 Quercus 导出的文件。',
                'Choose an .ics calendar file exported from Google, Outlook, Apple Calendar or Quercus.',
              )}
            </p>
            <p className="mt-2 max-w-sm text-[13px] leading-relaxed text-wx-meta">
              {tr('文件只在这台设备上读取，确认之后才会保存到课表。', 'The file is read on this device only; nothing is saved until you confirm.')}
            </p>
            {stage.kind === 'pick' && stage.error ? (
              <p role="alert" className="mt-4 max-w-sm text-[14px] leading-snug text-wx-red">
                {stage.error}
              </p>
            ) : null}
            <button
              type="button"
              disabled={stage.kind === 'reading'}
              onClick={() => inputRef.current?.click()}
              className="mt-6 flex min-h-11 items-center gap-2 rounded-lg bg-brand-800 px-5 text-[16px] font-medium text-white active:bg-brand-900 disabled:bg-stone-300"
            >
              {stage.kind === 'reading' ? <WxSpinner size={16} /> : null}
              {stage.kind === 'reading' ? tr('正在读取…', 'Reading…') : tr('选择文件', 'Choose a file')}
            </button>
          </div>
        ) : (
          <>
            <p className="px-4 pt-4 text-[13px] text-wx-meta">
              <span className="break-all">{stage.fileName}</span>
            </p>
            {ignoredText(stage.plan.ignored, locale) ? <p className="px-4 pt-1 text-[13px] leading-snug text-wx-meta">{ignoredText(stage.plan.ignored, locale)}</p> : null}

            {stage.plan.terms.length ? (
              <Section title={tr('新学期', 'New terms')}>
                {stage.plan.terms.map((term) => (
                  <label key={term.id} className="block px-4 py-3">
                    <span className="sr-only">{tr('学期名称', 'Term name')}</span>
                    <input
                      value={stage.choices.terms[term.id] ?? term.name}
                      maxLength={30}
                      onChange={(event) => {
                        const name = event.target.value;
                        updateChoices((draft) => {
                          draft.terms[term.id] = name;
                        });
                      }}
                      className="w-full rounded-md border border-transparent bg-transparent px-1 py-1 text-[16px] font-medium text-wx-ink focus:border-stone-300 focus:bg-white focus:outline-none"
                    />
                    <span className="block px-1 text-[13px] text-wx-meta">{termLine(term, locale)}</span>
                  </label>
                ))}
              </Section>
            ) : null}

            {stage.plan.courses.length ? (
              <Section title={tr('课程', 'Courses')}>
                {stage.plan.courses.map((course) => (
                  <CourseCard key={course.id} course={course} termName={termName(course.termId)} choices={stage.choices} locale={locale} onChoices={updateChoices} />
                ))}
              </Section>
            ) : null}

            {stage.plan.assignments.length ? (
              <Section title={tr('单次事件（可作为作业导入）', 'One-off events (import as assignments)')}>
                {stage.plan.assignments.map((assignment) => {
                  const id = `${titleId}-${assignment.id}`;
                  return (
                    <label key={assignment.id} htmlFor={id} className="flex min-h-12 items-center gap-3 px-4 py-2.5">
                      <input
                        id={id}
                        type="checkbox"
                        checked={stage.choices.assignments[assignment.id] ?? false}
                        onChange={(event) => {
                          const checked = event.target.checked;
                          updateChoices((draft) => {
                            draft.assignments[assignment.id] = checked;
                          });
                        }}
                        className="h-5 w-5 shrink-0 accent-brand-800"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] text-wx-ink">{assignment.title}</span>
                        <span className="block truncate text-[13px] text-wx-meta">
                          {assignmentLine(assignment, stage.nowMs, locale)}
                          {assignment.duplicate ? tr(' · 已有', ' · already added') : ''}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </Section>
            ) : null}
          </>
        )}
      </div>

      {stage.kind === 'preview' && built ? (
        <footer className="shrink-0 border-t-[0.5px] border-wx-line bg-wx-bar px-4 pt-2" style={{ paddingBottom: 'max(0.75rem, var(--safe-bottom))' }}>
          {!online ? <p className="pb-2 text-[13px] text-wx-meta">{tr('导入需要联网', 'Importing needs a connection')}</p> : null}
          {built.problems.length ? (
            <ul role="alert" className="pb-2 text-[13px] leading-snug text-wx-red">
              {built.problems.map((problem) => (
                <li key={`${problem.kind}-${'code' in problem ? problem.code : ''}`}>{importProblemText(problem, locale)}</li>
              ))}
            </ul>
          ) : null}
          {sendError ? (
            <p role="alert" className="pb-2 text-[13px] leading-snug text-wx-red">
              {sendError}
            </p>
          ) : null}
          <button
            type="button"
            disabled={!canImport}
            onClick={() => void submit()}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-brand-800 px-4 text-[16px] font-medium text-white active:bg-brand-900 disabled:bg-stone-300"
          >
            {sending ? <WxSpinner size={16} /> : null}
            {importButtonText(built.counts, locale)}
          </button>
        </footer>
      ) : null}
    </div>,
    document.body,
  );
}
