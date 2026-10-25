/**
 * Owner: T4, timetable quick add. The one-line assignment entry at the top of the 作业 tab, loaded lazily: type
 * "PS3 MAT102 周五 23:59", see the parse as chips (title, course, deadline, reminders), then 添加 or Enter hands a
 * complete assignment to onAdd. Its id comes from newTimetableId and its reminders from the default offsets.
 * 维护者：T4，课表快速添加。「作业」标签顶部的一行作业输入，按需加载：输入「PS3 MAT102 周五 23:59」，以标签显示解析结果（标题、课程、
 * 截止时间、提醒），然后点「添加」或按回车，把完整的作业交给 onAdd。id 来自 newTimetableId，提醒来自默认提醒时间。
 */
import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { SaveAssignmentBody } from '@utmmsc/shared';
import { useLocaleStore, useTr } from '../../../shared/i18n/locale';
import { courseColor } from '../model/colors';
import { newTimetableId } from '../model/ids';
import { useTorontoNow } from '../model/useTorontoNow';
import { useTimetableView } from '../state/timetableStore';
import { parseQuickAdd } from './parse';
import { quickAddBody, quickAddChips, type QuickAddChip } from './preview';

export interface QuickAddBarProps {
  /** A complete assignment, its id from newTimetableId and its offsets from the settings. */
  /** 完整的作业，id 来自 newTimetableId，提醒时间来自设置。 */
  onAdd: (body: SaveAssignmentBody) => void;
}

function chipClass(chip: QuickAddChip): string {
  const base = 'inline-flex max-w-full items-center truncate rounded-full px-2.5 py-0.5 text-[13px] leading-6';
  switch (chip.kind) {
    case 'title':
      return chip.missing ? `${base} border border-dashed border-stone-300 text-wx-meta` : `${base} bg-brand-50 font-medium text-brand-800`;
    case 'course':
      return `${base} font-semibold`;
    case 'due':
      return chip.assumed ? `${base} border border-dashed border-[#6B4E00]/40 text-[#6B4E00]` : `${base} bg-[#FFF1C2] text-[#6B4E00]`;
    case 'remind':
      return `${base} bg-wx-canvas text-wx-meta`;
  }
}

export default function QuickAddBar({ onAdd }: QuickAddBarProps): JSX.Element | null {
  const tr = useTr();
  const locale = useLocaleStore((state) => state.locale);
  const view = useTimetableView();
  const nowMs = useTorontoNow();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const [text, setText] = useState('');

  const parse = useMemo(() => parseQuickAdd(text, { courses: view.courses, terms: view.terms, nowMs }), [text, view.courses, view.terms, nowMs]);
  const offsets = view.settings.assignmentOffsets;
  const chips = useMemo(() => quickAddChips(parse, offsets, nowMs, locale), [parse, offsets, nowMs, locale]);
  const courseOf = (chip: QuickAddChip) => (chip.kind === 'course' && parse.courseId ? view.courses.find((course) => course.id === parse.courseId) : undefined);
  const ready = parse.title !== '';

  function add() {
    // The parse is taken again at the moment of adding, so a deadline like 今天 17:00 is read against now.
    // 添加时重新解析一次，「今天 17:00」这样的截止时间因此按此刻判断。
    const fresh = parseQuickAdd(text, { courses: view.courses, terms: view.terms, nowMs: Date.now() });
    const body = quickAddBody(fresh, offsets, newTimetableId('ta'));
    if (!body) return;
    onAdd(body);
    setText('');
    inputRef.current?.focus({ preventScroll: true });
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    // Enter that confirms an IME candidate (Safari reports keyCode 229) must not add the assignment.
    // 用于确认输入法候选词的回车（Safari 报告 keyCode 229）不能添加作业。
    if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
    add();
  }

  return (
    <form
      className="bg-white px-4 py-2.5"
      onSubmit={(event) => {
        event.preventDefault();
        add();
      }}
    >
      <label htmlFor={inputId} className="sr-only">
        {tr('快速添加作业', 'Quick add an assignment')}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={inputId}
          ref={inputRef}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          placeholder={tr('例如：PS3 MAT102 周五 23:59', 'e.g. PS3 MAT102 Fri 11:59pm')}
          enterKeyHint="done"
          autoComplete="off"
          maxLength={200}
          className="min-h-11 min-w-0 flex-1 rounded-lg bg-wx-canvas px-3 text-[16px] text-wx-ink placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
        />
        <button type="submit" disabled={!ready} className="min-h-11 shrink-0 rounded-lg bg-brand-800 px-4 text-[15px] font-medium text-white active:bg-brand-900 disabled:bg-stone-300">
          {tr('添加', 'Add')}
        </button>
      </div>
      {text.trim() ? (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={tr('将添加', 'Will add')}>
          {chips.map((chip) => {
            const course = courseOf(chip);
            const colors = course ? courseColor(course.color) : null;
            return (
              <li
                key={chip.kind}
                className={chipClass(chip)}
                style={colors ? { backgroundColor: colors.fill, color: colors.ink } : undefined}
                title={chip.kind === 'due' && chip.assumed ? tr('没有写日期和时间，已默认', 'No date or time given, so this was assumed') : undefined}
              >
                {chip.text}
              </li>
            );
          })}
        </ul>
      ) : null}
    </form>
  );
}
