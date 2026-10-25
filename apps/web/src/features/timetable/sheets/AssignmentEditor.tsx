/**
 * Owner: T3, timetable web core. 添加作业 / 编辑作业: title, course chips (or 无), due date chips (今天 / 明天 / 本周五 /
 * 下周一 / 选日期), due time chips (23:59 / 17:00 / 课前 / 选时间), reminder chips (at most three, defaulting from the
 * settings) and notes. Every time is read as Toronto time.
 * 维护者：T3，课表网页核心。「添加作业 / 编辑作业」：作业名称、课程选项（或「无」）、截止日期选项（今天 / 明天 / 本周五 / 下周一 / 选日期）、
 * 截止时间选项（23:59 / 17:00 / 课前 / 选时间）、提醒选项（最多三个，默认取自设置）以及备注。所有时间都按多伦多时间理解。
 */
import { useId, useMemo, useState } from 'react';
import { ASSIGNMENT_OFFSETS, formatClock, isoWeekday, shortCode, torontoDateOf, type TimetableLocale } from '@utmmsc/shared';
import { useConfirm } from '../../../shared/ui/confirm';
import { toast } from '../../../shared/ui/toast';
import { courseColor } from '../model/colors';
import { isDueDate } from '../model/formatDue';
import { monthDay, weekdayShort } from '../model/labels';
import { useTorontoNow } from '../model/useTorontoNow';
import { deleteAssignment, saveAssignment, setAssignmentDone, type TimetableView } from '../state/timetableStore';
import { ActionRow, Caption, Group, ROW_INPUT, ROW_SELECT } from '../ui/Cells';
import { Chip, ChipRow } from '../ui/Chip';
import { FullSheet } from '../ui/Sheet';
import {
  AFTERNOON_DUE_MIN,
  DEFAULT_DUE_MIN,
  DUE_HOURS,
  DUE_MINUTES,
  assignmentProblem,
  beforeClass,
  draftToBody,
  dueDateBounds,
  dueDateChips,
  offsetLabel,
  toggleOffset,
  type AssignmentDraft,
  type DueDateChip,
} from './assignmentDraft';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export interface AssignmentEditorProps {
  initial: AssignmentDraft;
  view: TimetableView;
  locale: TimetableLocale;
  onClose: () => void;
}

export function AssignmentEditor({ initial, view, locale, onClose }: AssignmentEditorProps) {
  const en = locale === 'en';
  const tr = (zh: string, enText: string) => (en ? enText : zh);
  const confirm = useConfirm();
  const now = useTorontoNow();
  const [draft, setDraft] = useState(initial);
  const [tried, setTried] = useState(false);
  const titleId = useId();
  const dateId = useId();
  const notesId = useId();
  const today = torontoDateOf(now);
  const chips = useMemo(() => dueDateChips(today), [today]);
  const lesson = useMemo(() => beforeClass(view, draft.courseId, now), [view, draft.courseId, now]);
  const existing = view.assignments.find((a) => a.id === draft.id) ?? null;
  const presetTime = draft.dueMin === DEFAULT_DUE_MIN || draft.dueMin === AFTERNOON_DUE_MIN;
  const lessonChosen = lesson !== null && lesson.date === draft.dueDate && lesson.minute === draft.dueMin;
  const [customTime, setCustomTime] = useState(() => !presetTime);
  const chipDate = (Object.keys(chips) as DueDateChip[]).find((key) => chips[key] === draft.dueDate) ?? null;
  const pickedDate = chipDate === null && isDueDate(draft.dueDate) ? `${weekdayShort(isoWeekday(draft.dueDate), locale)} ${monthDay(draft.dueDate, locale)}` : null;
  const bounds = useMemo(() => dueDateBounds(today), [today]);
  // What the date field holds while a year is half typed (0002-10-25); only a date in 2000-2100 reaches the draft.
  // 年份只输入了一半时（0002-10-25）日期栏中的内容；只有 2000-2100 年之间的日期才会写入草稿。
  const [typedDate, setTypedDate] = useState<string | null>(null);
  const problem = assignmentProblem(draft, now);

  const dateChipText: Record<DueDateChip, string> = {
    today: tr('今天', 'Today'),
    tomorrow: tr('明天', 'Tomorrow'),
    friday: isoWeekday(today) > 5 ? tr('下周五', 'Next Fri') : tr('本周五', 'This Fri'),
    monday: tr('下周一', 'Next Mon'),
  };

  function save() {
    setTried(true);
    if (problem) return;
    saveAssignment(draftToBody(draft));
    onClose();
  }

  async function remove() {
    const ok = await confirm({ title: tr(`删除「${draft.title.trim() || '这项作业'}」？`, `Delete “${draft.title.trim() || 'this assignment'}”?`), confirmLabel: tr('删除', 'Delete'), danger: true });
    if (!ok) return;
    deleteAssignment(draft.id);
    onClose();
  }

  const minuteValue = DUE_MINUTES.includes(draft.dueMin % 60) ? draft.dueMin % 60 : Math.floor((draft.dueMin % 60) / 5) * 5;

  return (
    <FullSheet title={draft.isNew ? tr('添加作业', 'Add assignment') : tr('编辑作业', 'Edit assignment')} onClose={onClose} primary={{ label: tr('保存', 'Save'), onClick: save }}>
      <Group caption={tr('作业名称', 'Title')}>
        <div className="flex min-h-14 items-center px-4">
          <label htmlFor={titleId} className="sr-only">
            {tr('作业名称', 'Title')}
          </label>
          <input
            id={titleId}
            className={ROW_INPUT}
            value={draft.title}
            maxLength={120}
            placeholder={tr('例如 PS3', 'e.g. PS3')}
            enterKeyHint="done"
            aria-invalid={tried && problem === 'title'}
            onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
          />
        </div>
      </Group>
      {tried && problem === 'title' ? (
        <p role="alert" className="px-4 pt-1.5 text-[13px] text-wx-red">
          {tr('请填写作业名称', 'Enter a name for the assignment')}
        </p>
      ) : null}

      <Caption>{tr('课程', 'Course')}</Caption>
      <div className="bg-white px-3 py-1">
        <ChipRow>
          <Chip selected={draft.courseId === null} onClick={() => setDraft((current) => ({ ...current, courseId: null }))}>
            {tr('无', 'None')}
          </Chip>
          {view.courses.map((course) => (
            <Chip key={course.id} selected={draft.courseId === course.id} onClick={() => setDraft((current) => ({ ...current, courseId: course.id }))}>
              <span aria-hidden className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: draft.courseId === course.id ? '#FFFFFF' : courseColor(course.color).ink }} />
              {shortCode(course.code)}
            </Chip>
          ))}
        </ChipRow>
      </div>

      <Caption>{tr('截止日期', 'Due date')}</Caption>
      <div className="bg-white px-3 py-1">
        <ChipRow>
          {(Object.keys(chips) as DueDateChip[]).map((key) => (
            <Chip key={key} selected={chipDate === key} onClick={() => setDraft((current) => ({ ...current, dueDate: chips[key] }))}>
              {dateChipText[key]}
            </Chip>
          ))}
          <label className="relative flex min-h-11 items-center">
            <span className={`flex h-8 items-center rounded-full px-3 text-[14px] ${pickedDate !== null ? 'bg-brand-800 text-white' : 'bg-white text-wx-ink ring-[0.5px] ring-inset ring-stone-300'}`}>
              {pickedDate ?? tr('选日期', 'Pick a date')}
            </span>
            <input
              id={dateId}
              type="date"
              aria-label={tr('选择截止日期', 'Choose the due date')}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              min={bounds.min}
              max={bounds.max}
              value={typedDate ?? draft.dueDate}
              onChange={(event) => {
                const value = event.target.value;
                if (isDueDate(value)) {
                  setTypedDate(null);
                  setDraft((current) => ({ ...current, dueDate: value }));
                } else {
                  setTypedDate(value);
                }
              }}
              onBlur={() => setTypedDate(null)}
            />
          </label>
        </ChipRow>
      </div>

      <Caption>{tr('截止时间', 'Due time')}</Caption>
      <div className="bg-white px-3 py-1">
        <ChipRow>
          <Chip
            selected={!customTime && draft.dueMin === DEFAULT_DUE_MIN && !lessonChosen}
            onClick={() => {
              setCustomTime(false);
              setDraft((current) => ({ ...current, dueMin: DEFAULT_DUE_MIN }));
            }}
          >
            {formatClock(DEFAULT_DUE_MIN, locale)}
          </Chip>
          <Chip
            selected={!customTime && draft.dueMin === AFTERNOON_DUE_MIN && !lessonChosen}
            onClick={() => {
              setCustomTime(false);
              setDraft((current) => ({ ...current, dueMin: AFTERNOON_DUE_MIN }));
            }}
          >
            {formatClock(AFTERNOON_DUE_MIN, locale)}
          </Chip>
          <Chip
            selected={lessonChosen && !customTime}
            disabled={lesson === null}
            onClick={() => {
              if (!lesson) return;
              setCustomTime(false);
              setDraft((current) => ({ ...current, dueDate: lesson.date, dueMin: lesson.minute }));
            }}
          >
            {lesson ? tr(`课前 · ${weekdayShort(isoWeekday(lesson.date), 'zh')} ${formatClock(lesson.minute, 'zh')}`, `Before class · ${weekdayShort(isoWeekday(lesson.date), 'en')} ${formatClock(lesson.minute, 'en')}`) : tr('课前', 'Before class')}
          </Chip>
          <Chip selected={customTime} onClick={() => setCustomTime(true)}>
            {tr('选时间', 'Pick a time')}
          </Chip>
        </ChipRow>
        {customTime ? (
          <div className="flex items-center gap-1 px-1 pb-2 pt-1">
            <select
              aria-label={tr('截止的小时', 'Due hour')}
              className={ROW_SELECT}
              value={Math.floor(draft.dueMin / 60)}
              onChange={(event) => setDraft((current) => ({ ...current, dueMin: Number(event.target.value) * 60 + (current.dueMin % 60) }))}
            >
              {DUE_HOURS.map((hour) => (
                <option key={hour} value={hour}>
                  {pad(hour)}
                </option>
              ))}
            </select>
            <span aria-hidden>:</span>
            <select
              aria-label={tr('截止的分钟', 'Due minute')}
              className={ROW_SELECT}
              value={minuteValue}
              onChange={(event) => setDraft((current) => ({ ...current, dueMin: Math.floor(current.dueMin / 60) * 60 + Number(event.target.value) }))}
            >
              {DUE_MINUTES.map((minute) => (
                <option key={minute} value={minute}>
                  {pad(minute)}
                </option>
              ))}
            </select>
            <span className="ml-2 text-[13px] text-wx-meta">{tr('多伦多时间', 'Toronto time')}</span>
          </div>
        ) : null}
      </div>
      {tried && problem === 'due_range' ? (
        <p role="alert" className="px-4 pt-1.5 text-[13px] text-wx-red">
          {tr('截止时间需在一年前到 400 天之后之间', 'The due time must be between a year ago and 400 days from now')}
        </p>
      ) : null}

      <Caption>{tr('提醒', 'Reminders')}</Caption>
      <div className="bg-white px-3 py-1">
        <ChipRow>
          {ASSIGNMENT_OFFSETS.map((token) => (
            <Chip
              key={token}
              selected={draft.offsets.includes(token)}
              onClick={() => {
                const next = toggleOffset(draft.offsets, token);
                if (next.refused) toast(tr('最多选 3 个提醒', 'Up to 3 reminders'));
                setDraft((current) => ({ ...current, offsets: next.offsets }));
              }}
            >
              {offsetLabel(token, locale)}
            </Chip>
          ))}
        </ChipRow>
      </div>
      <p className="px-4 pt-1.5 text-[13px] leading-5 text-wx-meta">{draft.offsets.length === 0 ? tr('不提醒', 'No reminders') : tr('最多选 3 个提醒', 'Up to 3 reminders')}</p>

      <Group caption={tr('备注', 'Notes')}>
        <div className="px-4 py-2">
          <label htmlFor={notesId} className="sr-only">
            {tr('备注', 'Notes')}
          </label>
          <textarea
            id={notesId}
            className="min-h-[88px] w-full resize-y bg-transparent text-[16px] text-wx-ink outline-none placeholder:text-stone-400"
            value={draft.notes}
            maxLength={1000}
            placeholder={tr('可选', 'Optional')}
            onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))}
          />
        </div>
      </Group>

      {existing ? (
        <Group>
          <ActionRow
            label={existing.doneAt ? tr('标记为未完成', 'Mark as not done') : tr('标记为已完成', 'Mark as done')}
            onClick={() => {
              // The edits made here are kept with the new state, unless the form cannot be saved as it is.
              // 此处所做的修改会与新的状态一起保存，除非表单当前无法保存。
              const done = existing.doneAt === null;
              if (problem) setAssignmentDone(existing.id, done);
              else saveAssignment({ ...draftToBody(draft), done });
              onClose();
            }}
          />
          <ActionRow label={tr('删除作业', 'Delete assignment')} danger onClick={() => void remove()} />
        </Group>
      ) : null}
    </FullSheet>
  );
}
