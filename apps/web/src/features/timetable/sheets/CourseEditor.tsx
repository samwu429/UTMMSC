/**
 * Owner: T3, timetable web core. 添加课程 / 编辑课程 (timetable-final.md section 10), fast path first: the course
 * code (chips of existing courses offer 添加到已有课程), then the class times, then 更多 (name, colour, term, notes,
 * the course's reminder switch). Problems show inline and mirror the server; overlaps are a notice that never
 * stops the save. Saving applies at once and syncs in the background.
 * 维护者：T3，课表网页核心。「添加课程 / 编辑课程」（timetable-final.md 第 10 节），常用内容在前：课程代码（已有课程的选项提供「添加到已有课程」），
 * 然后是上课时间，最后是「更多」（课程名称、颜色、学期、备注、这门课上课提醒）。问题在表单内显示，与服务器一致；时间重叠只是提示，从不阻止保存。
 * 保存后立即生效，并在后台同步。
 */
import { useCallback, useId, useMemo, useState } from 'react';
import { COURSE_COLORS, shortCode, type CourseColor, type TimetableLocale, type TimetableTerm } from '@utmmsc/shared';
import { courseColor } from '../model/colors';
import { newTimetableId } from '../model/ids';
import { findConflicts } from '../model/week';
import { saveCourse, type TimetableView } from '../state/timetableStore';
import { Caption, Group, ROW_INPUT, ROW_SELECT, SwitchRow } from '../ui/Cells';
import { Chip, ChipRow } from '../ui/Chip';
import { ChevronDownIcon } from '../ui/icons';
import { rememberDuration } from '../ui/prefs';
import { FullSheet } from '../ui/Sheet';
import {
  TIME_TEMPLATES,
  addToCourse,
  conflictNotices,
  copyRow,
  draftProblems,
  draftToBody,
  nextRow,
  recentLocations,
  rowDuration,
  withTemplate,
  type CourseDraft,
  type MeetingRowDraft,
  type NewRowAt,
} from './courseDraft';
import { MeetingRowEditor } from './MeetingRowEditor';

const COLOR_ZH: Record<CourseColor, string> = {
  purple: '紫',
  gold: '金',
  blue: '蓝',
  green: '绿',
  red: '红',
  teal: '青',
  orange: '橙',
  pink: '粉',
  indigo: '靛',
  lime: '黄绿',
  brown: '棕',
  slate: '灰',
};

function templateText(id: string, locale: TimetableLocale): string {
  const en = locale === 'en';
  switch (id) {
    case 'mwf':
      return en ? 'Mon Wed Fri · 1 h' : '一三五 · 1小时';
    case 'tth':
      return en ? 'Tue Thu · 1.5 h' : '二四 · 1.5小时';
    case 'once2':
      return en ? 'Once · 2 h' : '单次 · 2小时';
    default:
      return en ? 'Once · 3 h' : '单次 · 3小时';
  }
}

let rowSeq = 0;
/** A key for a new form row; rows never leave the device. */
/** 新表单行的键；表单行不会离开这台设备。 */
export function newRowKey(): string {
  rowSeq += 1;
  return `row-${rowSeq}`;
}

export interface CourseEditorProps {
  initial: CourseDraft;
  view: TimetableView;
  locale: TimetableLocale;
  /** The slot that was tapped, for 添加到已有课程. */
  /** 被点按的时间格，用于「添加到已有课程」。 */
  slot: NewRowAt | null;
  lastDuration: number | null;
  onClose: () => void;
}

export function CourseEditor({ initial, view, locale, slot, lastDuration, onClose }: CourseEditorProps) {
  const en = locale === 'en';
  const tr = (zh: string, enText: string) => (en ? enText : zh);
  const [draft, setDraft] = useState<CourseDraft>(initial);
  const [tried, setTried] = useState(false);
  const [more, setMore] = useState(false);
  const codeId = useId();
  const titleId = useId();
  const termId = useId();
  const notesId = useId();
  const [slotDuration] = useState(() => (initial.rows[0] ? rowDuration(initial.rows[0]) : 60));

  const term: TimetableTerm | null = draft.termId ? (view.terms.find((t) => t.id === draft.termId) ?? null) : null;
  const hasTerm = term !== null;
  const problems = draftProblems(draft, hasTerm);
  const locations = useMemo(() => recentLocations(view.courses), [view.courses]);
  const preview = useMemo(() => draftToBody(draft, () => 'tm_preview', hasTerm), [draft, hasTerm]);
  const notices = useMemo(() => conflictNotices(findConflicts(preview, view.courses, view.terms), locale), [preview, view.courses, view.terms, locale]);
  const existing = useMemo(() => (draft.isNew && slot ? view.courses.filter((course) => course.id !== draft.id) : []), [draft.isNew, draft.id, slot, view.courses]);

  const changeRow = useCallback((row: MeetingRowDraft) => setDraft((current) => ({ ...current, rows: current.rows.map((r) => (r.key === row.key ? row : r)) })), []);
  const duplicateRow = useCallback(
    (row: MeetingRowDraft) =>
      setDraft((current) => {
        const index = current.rows.findIndex((r) => r.key === row.key);
        const rows = [...current.rows];
        rows.splice(index + 1, 0, copyRow(row, newRowKey()));
        return { ...current, rows };
      }),
    [],
  );
  const removeRow = useCallback((row: MeetingRowDraft) => setDraft((current) => ({ ...current, rows: current.rows.filter((r) => r.key !== row.key) })), []);

  function applyTemplate(template: (typeof TIME_TEMPLATES)[number]) {
    setDraft((current) => {
      const last = current.rows[current.rows.length - 1];
      if (!last) return current;
      return { ...current, rows: current.rows.map((r) => (r.key === last.key ? withTemplate(r, template) : r)) };
    });
  }

  function save() {
    setTried(true);
    if (problems.any) return;
    saveCourse(draftToBody(draft, () => newTimetableId('tm'), hasTerm));
    const first = draft.rows[0];
    if (first) rememberDuration(rowDuration(first));
    onClose();
  }

  const title = draft.isNew ? tr('添加课程', 'Add course') : tr('编辑课程', 'Edit course');

  return (
    <FullSheet title={title} onClose={onClose} primary={{ label: tr('保存', 'Save'), onClick: save }}>
      {existing.length > 0 ? (
        <section aria-label={tr('添加到已有课程', 'Add to a course')}>
          <Caption>{tr('添加到已有课程', 'Add to a course')}</Caption>
          <div className="bg-white px-3 py-1">
            <ChipRow>
              {existing.map((course) => (
                <Chip key={course.id} action onClick={() => slot && setDraft(addToCourse(course, slot, slotDuration, newRowKey))}>
                  <span aria-hidden className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: courseColor(course.color).ink }} />
                  {shortCode(course.code)}
                </Chip>
              ))}
            </ChipRow>
          </div>
        </section>
      ) : null}

      <Group caption={tr('课程代码', 'Course code')}>
        <div className="flex min-h-14 items-center gap-3 px-4">
          <span aria-hidden className="h-6 w-1.5 shrink-0 rounded-full" style={{ background: courseColor(draft.color).ink }} />
          <label htmlFor={codeId} className="sr-only">
            {tr('课程代码', 'Course code')}
          </label>
          <input
            id={codeId}
            className={`${ROW_INPUT} uppercase`}
            value={draft.code}
            placeholder={tr('例如 MAT102H5F', 'e.g. MAT102H5F')}
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="done"
            aria-invalid={tried && problems.code !== null}
            onChange={(event) => setDraft((current) => ({ ...current, code: event.target.value }))}
          />
        </div>
      </Group>
      {tried && problems.code ? (
        <p role="alert" className="px-4 pt-1.5 text-[13px] text-wx-red">
          {tr('请填写课程代码（最多 20 个字符）', 'Enter a course code (up to 20 characters)')}
        </p>
      ) : null}

      {draft.rows.map((row, index) => (
        <MeetingRowEditor
          key={row.key}
          row={row}
          index={index}
          locale={locale}
          term={term}
          recentLocations={locations}
          lastDuration={lastDuration}
          problem={tried ? (problems.rows[row.key] ?? null) : null}
          canRemove={draft.rows.length > 1}
          onChange={changeRow}
          onCopy={duplicateRow}
          onRemove={removeRow}
        />
      ))}

      <div className="px-3 pt-2">
        <ChipRow>
          {TIME_TEMPLATES.map((template) => (
            <Chip key={template.id} action onClick={() => applyTemplate(template)}>
              {templateText(template.id, locale)}
            </Chip>
          ))}
        </ChipRow>
      </div>
      <div className="px-4 pt-1">
        <button
          type="button"
          onClick={() => setDraft((current) => ({ ...current, rows: [...current.rows, nextRow(current.rows[current.rows.length - 1], newRowKey())] }))}
          className="min-h-11 text-[15px] font-medium text-wx-link active:opacity-60"
        >
          {tr('+ 添加上课时间', '+ Add a class time')}
        </button>
      </div>
      {problems.tooMany ? (
        <p role="alert" className="px-4 text-[13px] text-wx-red">
          {tr('每门课最多 10 个上课时间', 'A course can have at most 10 class times')}
        </p>
      ) : null}
      {notices.length > 0 ? (
        <div role="status" className="mx-4 mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[13px] leading-5 text-amber-900">
          {notices.map((notice) => (
            <p key={notice}>{notice}</p>
          ))}
          <p className="mt-0.5 text-amber-800/80">{tr('仍然可以保存', 'You can still save')}</p>
        </div>
      ) : null}

      <div className="mt-4 bg-white">
        <button type="button" aria-expanded={more} onClick={() => setMore((open) => !open)} className="flex min-h-12 w-full items-center gap-2 px-4 text-left active:bg-wx-pressed">
          <span className="flex-1 text-[16px] text-wx-ink">{tr('更多', 'More')}</span>
          <span className="truncate text-[14px] text-wx-meta">{term ? term.name : tr('不属于学期 · 每周重复', 'No term · every week')}</span>
          <ChevronDownIcon className={`h-4 w-4 shrink-0 text-stone-400 transition-transform motion-reduce:transition-none ${more ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {more ? (
        <>
          <Group caption={tr('课程名称', 'Course name')}>
            <div className="flex min-h-14 items-center px-4">
              <label htmlFor={titleId} className="sr-only">
                {tr('课程名称', 'Course name')}
              </label>
              <input
                id={titleId}
                className={ROW_INPUT}
                value={draft.title}
                maxLength={80}
                placeholder={tr('可选，例如 微积分', 'Optional, e.g. Calculus')}
                onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
              />
            </div>
          </Group>
          <Group caption={tr('颜色', 'Colour')}>
            <div className="grid grid-cols-6 gap-y-1 px-3 py-2" role="radiogroup" aria-label={tr('颜色', 'Colour')}>
              {COURSE_COLORS.map((color) => {
                const pair = courseColor(color);
                const selected = draft.color === color;
                return (
                  <button
                    key={color}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={en ? color : COLOR_ZH[color]}
                    onClick={() => setDraft((current) => ({ ...current, color }))}
                    className="flex min-h-11 items-center justify-center"
                  >
                    <span
                      className="flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-semibold"
                      style={{ background: pair.fill, color: pair.ink, boxShadow: selected ? `0 0 0 2px #FFFFFF, 0 0 0 4px ${pair.ink}` : `inset 0 0 0 1.5px ${pair.ink}` }}
                    >
                      {selected ? 'Aa' : ''}
                    </span>
                  </button>
                );
              })}
            </div>
          </Group>
          <Group caption={tr('学期', 'Term')} footer={view.terms.length === 0 ? tr('在「⋯ → 学期」中添加学期后，可以设置单双周和阅读周。', 'Add a term under ⋯ → Terms to use odd and even weeks and reading week.') : undefined}>
            <div className="flex min-h-14 items-center px-4">
              <label htmlFor={termId} className="sr-only">
                {tr('学期', 'Term')}
              </label>
              <select
                id={termId}
                className={`${ROW_SELECT} w-full`}
                value={draft.termId ?? ''}
                onChange={(event) => {
                  const next = event.target.value === '' ? null : event.target.value;
                  // Without a term only 每周 is possible, so the rows go back to it.
                  // 没有学期时只能每周上课，因此各行恢复为每周。
                  setDraft((current) => ({ ...current, termId: next, rows: next ? current.rows : current.rows.map((row) => ({ ...row, weekRule: 'all' as const })) }));
                }}
              >
                <option value="">{tr('不属于学期 · 每周重复', 'No term · repeats every week')}</option>
                {view.terms.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          </Group>
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
          <Group>
            <SwitchRow label={tr('这门课上课提醒', 'Remind me before this class')} checked={draft.remind} onChange={(remind) => setDraft((current) => ({ ...current, remind }))} />
          </Group>
        </>
      ) : null}
    </FullSheet>
  );
}
