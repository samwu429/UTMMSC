/**
 * Owner: T3, timetable web core. 学期: the member's terms (at most 6) and the term form: name (from the month by
 * default), start (Monday of this week) and end (13 weeks later), reading-week chips over the term's weeks,
 * 复制到新学期 (every course copied with new ids and every week), and delete, which says how many courses go with it.
 * 维护者：T3，课表网页核心。「学期」：成员的学期（最多 6 个）和学期表单：名称（默认按月份）、开始日期（本周一）和结束日期（13 周后）、
 * 覆盖学期各周的阅读周选项、「复制到新学期」（每门课以新 id 复制，并改为每周），以及删除（会说明将一并删除多少门课程）。
 */
import { useId, useState } from 'react';
import { isTimetableDate, termWeekCount, torontoDateOf, type SaveTermBody, type TimetableLocale, type TimetableTerm } from '@utmmsc/shared';
import { useConfirm } from '../../../shared/ui/confirm';
import { newTimetableId } from '../model/ids';
import { dateRange } from '../model/labels';
import { deleteTerm, saveCourse, saveTerm, type TimetableView } from '../state/timetableStore';
import { ActionRow, Caption, Group, ROW_INPUT } from '../ui/Cells';
import { Chip, ChipRow } from '../ui/Chip';
import { FullSheet } from '../ui/Sheet';
import { copyCourses, coursesInTerm, defaultEnd, keepSkipWeeks, newTermDraft, nextTermDraft, termProblem, termWeeks, type TermProblem } from './termDraft';

interface Editing {
  draft: SaveTermBody;
  isNew: boolean;
  /** 复制到新学期: the term whose courses the new one receives. */
  /** 「复制到新学期」：新学期将得到哪个学期的课程。 */
  copyFrom: TimetableTerm | null;
}

function problemText(problem: TermProblem, tr: (zh: string, en: string) => string): string {
  switch (problem) {
    case 'name':
      return tr('请填写学期名称', 'Enter a name for the term');
    case 'dates':
      return tr('结束日期不能早于开始日期', 'The end cannot be before the start');
    case 'too_long':
      return tr('学期最长 40 周', 'A term can be at most 40 weeks long');
    case 'too_many':
      return tr('最多 6 个学期', 'You can have at most 6 terms');
  }
}

function TermEditor({ editing, view, locale, onClose }: { editing: Editing; view: TimetableView; locale: TimetableLocale; onClose: (next?: Editing) => void }) {
  const en = locale === 'en';
  const tr = (zh: string, enText: string) => (en ? enText : zh);
  const confirm = useConfirm();
  const [draft, setDraft] = useState(editing.draft);
  const [tried, setTried] = useState(false);
  const nameId = useId();
  const startId = useId();
  const endId = useId();
  const problem = termProblem(draft, view.terms);
  const weeks = termWeeks(draft);
  const courseCount = coursesInTerm(view.courses, draft.id);
  const copyCount = editing.copyFrom ? coursesInTerm(view.courses, editing.copyFrom.id) : 0;

  function save() {
    setTried(true);
    if (problem) return;
    const body = keepSkipWeeks({ ...draft, name: draft.name.trim() });
    saveTerm(body);
    if (editing.copyFrom) {
      for (const course of copyCourses(view.courses, editing.copyFrom.id, body.id, () => newTimetableId('tc'), () => newTimetableId('tm'))) saveCourse(course);
    }
    onClose();
  }

  async function remove() {
    const ok = await confirm({
      title: tr(`删除「${draft.name}」？`, `Delete “${draft.name}”?`),
      body: courseCount > 0 ? tr(`将同时删除 ${courseCount} 门课程`, `This also deletes ${courseCount} ${courseCount === 1 ? 'course' : 'courses'}`) : undefined,
      confirmLabel: tr('删除', 'Delete'),
      danger: true,
    });
    if (!ok) return;
    deleteTerm(draft.id);
    onClose();
  }

  return (
    <FullSheet
      raised
      title={editing.copyFrom ? tr('复制到新学期', 'Copy to a new term') : editing.isNew ? tr('添加学期', 'Add term') : tr('编辑学期', 'Edit term')}
      onClose={() => onClose()}
      primary={{ label: tr('保存', 'Save'), onClick: save }}
    >
      {editing.copyFrom ? (
        <p className="px-4 pt-3 text-[13px] leading-5 text-wx-meta">
          {tr(`将复制「${editing.copyFrom.name}」的 ${copyCount} 门课程，周次都改为每周。`, `Copies the ${copyCount} courses of “${editing.copyFrom.name}”, all set to every week.`)}
        </p>
      ) : null}
      <Group caption={tr('名称', 'Name')}>
        <div className="flex min-h-14 items-center px-4">
          <label htmlFor={nameId} className="sr-only">
            {tr('名称', 'Name')}
          </label>
          <input id={nameId} className={ROW_INPUT} value={draft.name} maxLength={30} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
        </div>
      </Group>
      <Group caption={tr('日期', 'Dates')}>
        <div className="flex min-h-14 items-center gap-3 px-4">
          <label htmlFor={startId} className="w-16 shrink-0 text-[16px] text-wx-ink">
            {tr('开始', 'Starts')}
          </label>
          <input
            id={startId}
            type="date"
            className={`${ROW_INPUT} text-right`}
            value={draft.startsOn}
            onChange={(event) => {
              const startsOn = event.target.value;
              if (!isTimetableDate(startsOn)) return;
              // A new term keeps its default length when the start moves; an existing one keeps its end.
              // 新学期在开始日期改变时保持默认长度；已有学期保持其结束日期。
              setDraft((current) => ({ ...current, startsOn, endsOn: editing.isNew ? defaultEnd(startsOn) : current.endsOn }));
            }}
          />
        </div>
        <div className="flex min-h-14 items-center gap-3 px-4">
          <label htmlFor={endId} className="w-16 shrink-0 text-[16px] text-wx-ink">
            {tr('结束', 'Ends')}
          </label>
          <input
            id={endId}
            type="date"
            className={`${ROW_INPUT} text-right`}
            value={draft.endsOn}
            onChange={(event) => {
              const endsOn = event.target.value;
              if (isTimetableDate(endsOn)) setDraft((current) => ({ ...current, endsOn }));
            }}
          />
        </div>
      </Group>
      {tried && problem ? (
        <p role="alert" className="px-4 pt-1.5 text-[13px] text-wx-red">
          {problemText(problem, tr)}
        </p>
      ) : (
        <p className="px-4 pt-1.5 text-[13px] text-wx-meta">{weeks.length > 0 ? tr(`共 ${termWeekCount(draft)} 周`, `${termWeekCount(draft)} weeks`) : ''}</p>
      )}
      {weeks.length > 0 ? (
        <>
          <Caption>{tr('阅读周（不上课的周）', 'Reading week (no classes)')}</Caption>
          <div className="bg-white px-3 py-1">
            <ChipRow>
              {weeks.map((week) => (
                <Chip
                  key={week}
                  round
                  label={tr(`第 ${week} 周`, `Week ${week}`)}
                  selected={draft.skipWeeks.includes(week)}
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      skipWeeks: current.skipWeeks.includes(week) ? current.skipWeeks.filter((w) => w !== week) : [...current.skipWeeks, week].sort((a, b) => a - b),
                    }))
                  }
                >
                  {week}
                </Chip>
              ))}
            </ChipRow>
          </div>
        </>
      ) : null}
      {!editing.isNew ? (
        <Group>
          <ActionRow
            label={tr('复制到新学期', 'Copy to a new term')}
            detail={tr('复制这个学期的所有课程', 'Copies every course of this term')}
            onClick={() => {
              const source = view.terms.find((t) => t.id === draft.id);
              if (source) onClose({ draft: nextTermDraft(newTimetableId('tt'), source, locale), isNew: true, copyFrom: source });
            }}
          />
          <ActionRow label={tr('删除学期', 'Delete term')} danger onClick={() => void remove()} />
        </Group>
      ) : null}
    </FullSheet>
  );
}

export function TermsSheet({ view, locale, onClose }: { view: TimetableView; locale: TimetableLocale; onClose: () => void }) {
  const en = locale === 'en';
  const tr = (zh: string, enText: string) => (en ? enText : zh);
  const [editing, setEditing] = useState<Editing | null>(null);
  const full = view.terms.length >= 6;
  const sorted = [...view.terms].sort((a, b) => (a.startsOn < b.startsOn ? -1 : a.startsOn > b.startsOn ? 1 : 0));

  return (
    <FullSheet title={tr('学期', 'Terms')} onClose={onClose} closeLabel={tr('完成', 'Done')}>
      <Group footer={tr('第 1 周是包含开始日期的那一周（周一到周日）。', 'Week 1 is the Monday-to-Sunday week holding the start date.')}>
        {sorted.map((term) => {
          const count = coursesInTerm(view.courses, term.id);
          return (
            <ActionRow
              key={term.id}
              label={term.name}
              detail={`${dateRange(term.startsOn, term.endsOn, locale)} · ${tr(`${count} 门课程`, `${count} ${count === 1 ? 'course' : 'courses'}`)}`}
              onClick={() => setEditing({ draft: { id: term.id, name: term.name, startsOn: term.startsOn, endsOn: term.endsOn, skipWeeks: [...term.skipWeeks] }, isNew: false, copyFrom: null })}
            />
          );
        })}
        <button
          type="button"
          disabled={full}
          onClick={() => setEditing({ draft: newTermDraft(newTimetableId('tt'), torontoDateOf(Date.now()), locale), isNew: true, copyFrom: null })}
          className="flex min-h-14 w-full items-center px-4 text-left text-[16px] font-medium text-wx-link active:bg-wx-pressed disabled:text-stone-400"
        >
          {full ? tr('最多 6 个学期', 'At most 6 terms') : tr('+ 添加学期', '+ Add term')}
        </button>
      </Group>
      {editing ? <TermEditor key={editing.draft.id} editing={editing} view={view} locale={locale} onClose={(next) => setEditing(next ?? null)} /> : null}
    </FullSheet>
  );
}
