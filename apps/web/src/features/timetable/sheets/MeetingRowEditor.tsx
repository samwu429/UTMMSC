/**
 * Owner: T3, timetable web core. One 上课时间 row of the course form: day chips (several days give one meeting
 * each), start and end as native selects that only offer valid times, duration chips, the location with recent
 * ones, the kind and section, and the weeks.
 * 维护者：T3，课表网页核心。课程表单中的一行「上课时间」：星期选项（选多个星期会各得一个上课时间）、只提供有效时间的系统下拉框（开始与结束）、
 * 时长选项、带最近地点的地点输入、上课类型与分组，以及周次。
 */
import { memo, useId } from 'react';
import { MEETING_KINDS, type TimetableLocale, type TimetableTerm, type Weekday, type WeekRule } from '@utmmsc/shared';
import { kindLabel, weekdayChar, weekdayLong } from '../model/labels';
import { Chip, ChipRow } from '../ui/Chip';
import { ROW_INPUT, ROW_SELECT } from '../ui/Cells';
import {
  DURATION_CHOICES,
  endAtHour,
  endHours,
  endMinutes,
  rowDuration,
  rowProblemText,
  selectableWeeks,
  startHours,
  startMinutes,
  toggleDay,
  withDuration,
  withSection,
  withStart,
  type MeetingRowDraft,
  type RowProblem,
} from './courseDraft';

const WEEKDAYS: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 7];
const WEEK_RULE_ORDER: readonly WeekRule[] = ['all', 'odd', 'even', 'list'];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function durationText(minutes: number, locale: TimetableLocale): string {
  const hours = minutes / 60;
  if (locale === 'en') return Number.isInteger(hours) ? `${hours} h` : minutes % 30 === 0 ? `${hours} h` : `${minutes} min`;
  return Number.isInteger(hours) || minutes % 30 === 0 ? `${hours}小时` : `${minutes}分钟`;
}

function ruleText(rule: WeekRule, locale: TimetableLocale): string {
  const en = locale === 'en';
  switch (rule) {
    case 'all':
      return en ? 'Every week' : '每周';
    case 'odd':
      return en ? 'Odd weeks' : '单周';
    case 'even':
      return en ? 'Even weeks' : '双周';
    case 'list':
      return en ? 'Custom' : '自定义';
  }
}

export interface MeetingRowEditorProps {
  row: MeetingRowDraft;
  index: number;
  locale: TimetableLocale;
  term: TimetableTerm | null;
  recentLocations: readonly string[];
  lastDuration: number | null;
  problem: RowProblem | null;
  canRemove: boolean;
  onChange: (row: MeetingRowDraft) => void;
  onCopy: (row: MeetingRowDraft) => void;
  onRemove: (row: MeetingRowDraft) => void;
}

function MeetingRowEditorView({ row, index, locale, term, recentLocations, lastDuration, problem, canRemove, onChange, onCopy, onRemove }: MeetingRowEditorProps) {
  const en = locale === 'en';
  const tr = (zh: string, enText: string) => (en ? enText : zh);
  const startId = useId();
  const endId = useId();
  const locationId = useId();
  const sectionId = useId();
  const startHour = Math.floor(row.startMin / 60);
  const endHour = Math.floor(row.endMin / 60);
  const duration = rowDuration(row);
  const durations = [...DURATION_CHOICES] as number[];
  const lastOffered = lastDuration !== null && !durations.includes(lastDuration);
  const weeks = selectableWeeks(term);
  const startHourList = startHours();
  const endHourList = endHours(row.startMin);

  return (
    <section aria-label={tr(`上课时间 ${index + 1}`, `Class time ${index + 1}`)}>
      <div className="flex items-center px-4 pb-1.5 pt-4">
        <h3 className="flex-1 text-[13px] leading-5 text-wx-meta">{tr(`上课时间 ${index + 1}`, `Class time ${index + 1}`)}</h3>
        <button type="button" onClick={() => onCopy(row)} className="min-h-9 px-2 text-[13px] text-wx-link active:opacity-60">
          {tr('复制这一行', 'Copy row')}
        </button>
        {canRemove ? (
          <button type="button" onClick={() => onRemove(row)} className="min-h-9 px-2 text-[13px] text-wx-red active:opacity-60">
            {tr('删除', 'Remove')}
          </button>
        ) : null}
      </div>
      <div className="bg-white">
        <div className="px-3 py-1">
          <ChipRow className="justify-between">
            {WEEKDAYS.map((day) => (
              <Chip key={day} round selected={row.days.includes(day)} onClick={() => onChange(toggleDay(row, day))} label={weekdayLong(day, locale)}>
                {weekdayChar(day, locale)}
              </Chip>
            ))}
          </ChipRow>
        </div>
        <div aria-hidden className="ml-4 h-[0.5px] bg-wx-line" />
        <div className="flex min-h-14 flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2">
          <label htmlFor={startId} className="w-12 shrink-0 text-[16px] text-wx-ink">
            {tr('时间', 'Time')}
          </label>
          <span className="flex items-center gap-1">
            <select
              id={startId}
              aria-label={tr('开始的小时', 'Start hour')}
              className={ROW_SELECT}
              value={startHour}
              onChange={(event) => {
                const hour = Number(event.target.value);
                const minutes = startMinutes(hour);
                const minute = minutes.includes(row.startMin % 60) ? row.startMin % 60 : (minutes[minutes.length - 1] ?? 0);
                onChange(withStart(row, hour * 60 + minute));
              }}
            >
              {startHourList.map((hour) => (
                <option key={hour} value={hour}>
                  {pad(hour)}
                </option>
              ))}
            </select>
            <span aria-hidden>:</span>
            <select aria-label={tr('开始的分钟', 'Start minute')} className={ROW_SELECT} value={row.startMin % 60} onChange={(event) => onChange(withStart(row, startHour * 60 + Number(event.target.value)))}>
              {startMinutes(startHour).map((minute) => (
                <option key={minute} value={minute}>
                  {pad(minute)}
                </option>
              ))}
            </select>
          </span>
          <span aria-hidden className="text-wx-meta">
            –
          </span>
          <span className="flex items-center gap-1">
            <select
              id={endId}
              aria-label={tr('结束的小时', 'End hour')}
              className={ROW_SELECT}
              value={endHourList.includes(endHour) ? endHour : (endHourList[0] ?? endHour)}
              onChange={(event) => onChange({ ...row, endMin: endAtHour(row, Number(event.target.value)) })}
            >
              {endHourList.map((hour) => (
                <option key={hour} value={hour}>
                  {pad(hour)}
                </option>
              ))}
            </select>
            <span aria-hidden>:</span>
            <select aria-label={tr('结束的分钟', 'End minute')} className={ROW_SELECT} value={row.endMin % 60} onChange={(event) => onChange({ ...row, endMin: endHour * 60 + Number(event.target.value) })}>
              {endMinutes(row.startMin, endHour).map((minute) => (
                <option key={minute} value={minute}>
                  {pad(minute)}
                </option>
              ))}
            </select>
          </span>
        </div>
        <div className="px-3 pb-1">
          <ChipRow>
            {durations.map((minutes) => (
              <Chip key={minutes} selected={duration === minutes} onClick={() => onChange(withDuration(row, minutes))}>
                {durationText(minutes, locale)}
              </Chip>
            ))}
            {lastOffered && lastDuration !== null ? (
              <Chip selected={duration === lastDuration} onClick={() => onChange(withDuration(row, lastDuration))}>
                {tr(`上次用的 · ${durationText(lastDuration, 'zh')}`, `Last used · ${durationText(lastDuration, 'en')}`)}
              </Chip>
            ) : null}
          </ChipRow>
        </div>
        <div aria-hidden className="ml-4 h-[0.5px] bg-wx-line" />
        <div className="flex min-h-14 items-center gap-3 px-4">
          <label htmlFor={locationId} className="w-12 shrink-0 text-[16px] text-wx-ink">
            {tr('地点', 'Room')}
          </label>
          <input
            id={locationId}
            className={ROW_INPUT}
            value={row.location}
            maxLength={60}
            placeholder={tr('例如 DV 2074', 'e.g. DV 2074')}
            autoComplete="off"
            onChange={(event) => onChange({ ...row, location: event.target.value })}
          />
        </div>
        {recentLocations.length > 0 ? (
          <div className="px-3 pb-1">
            <ChipRow>
              {recentLocations.map((location) => (
                <Chip key={location} selected={row.location.trim() === location} onClick={() => onChange({ ...row, location })}>
                  {location}
                </Chip>
              ))}
            </ChipRow>
          </div>
        ) : null}
        <div aria-hidden className="ml-4 h-[0.5px] bg-wx-line" />
        <div className="px-3 pt-1">
          <ChipRow>
            {MEETING_KINDS.map((kind) => (
              <Chip key={kind} selected={row.kind === kind} onClick={() => onChange({ ...row, kind })}>
                {kindLabel(kind, locale)}
              </Chip>
            ))}
          </ChipRow>
        </div>
        <div className="flex min-h-12 items-center gap-3 px-4">
          <label htmlFor={sectionId} className="w-12 shrink-0 text-[16px] text-wx-ink">
            {tr('分组', 'Section')}
          </label>
          <input
            id={sectionId}
            className={`${ROW_INPUT} uppercase`}
            value={row.section}
            maxLength={12}
            placeholder={tr('可选，例如 TUT0103', 'Optional, e.g. TUT0103')}
            autoCapitalize="characters"
            autoComplete="off"
            onChange={(event) => onChange(withSection(row, event.target.value))}
          />
        </div>
        <div aria-hidden className="ml-4 h-[0.5px] bg-wx-line" />
        <div className="px-3 py-1">
          <ChipRow>
            {WEEK_RULE_ORDER.map((rule) => (
              <Chip key={rule} selected={row.weekRule === rule} disabled={rule !== 'all' && !term} onClick={() => onChange({ ...row, weekRule: rule })}>
                {ruleText(rule, locale)}
              </Chip>
            ))}
          </ChipRow>
          {!term ? <p className="pb-1 pl-1 text-[12px] leading-4 text-wx-meta">{tr('单双周和自定义周次需要先在「更多」中选择学期', 'Odd, even and custom weeks need a term, chosen under More')}</p> : null}
          {row.weekRule === 'list' && term ? (
            <ChipRow className="pt-1">
              {weeks.map((week) => (
                <Chip
                  key={week}
                  round
                  label={tr(`第 ${week} 周`, `Week ${week}`)}
                  selected={row.weekList.includes(week)}
                  onClick={() =>
                    onChange({ ...row, weekList: row.weekList.includes(week) ? row.weekList.filter((w) => w !== week) : [...row.weekList, week].sort((a, b) => a - b) })
                  }
                >
                  {week}
                </Chip>
              ))}
            </ChipRow>
          ) : null}
        </div>
      </div>
      {problem ? (
        <p role="alert" className="px-4 pt-1.5 text-[13px] leading-5 text-wx-red">
          {rowProblemText(problem, tr)}
        </p>
      ) : null}
    </section>
  );
}

export const MeetingRowEditor = memo(MeetingRowEditorView);
