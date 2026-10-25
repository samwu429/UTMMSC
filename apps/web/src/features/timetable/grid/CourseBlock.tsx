/**
 * Owner: T3, timetable web core. One class on the week grid: an absolutely placed button in the course colours
 * with the short code, the location when there is room, a ! for an overlap, hatching for 已停课 and a dot while
 * it waits to sync. Memoised, so a swipe or a minute tick never redraws it.
 * 维护者：T3，课表网页核心。周课表上的一节课：按课程颜色绘制、绝对定位的按钮，显示简短代码，有空间时显示地点，重叠时显示 !，
 * 「已停课」显示为斜线，等待同步时显示圆点。已做记忆化，因此滑动或每分钟的跳动都不会重绘它。
 */
import { memo, type CSSProperties } from 'react';
import { shortCode, type TimetableLocale, type Weekday } from '@utmmsc/shared';
import { useLongPress } from '../../../shared/ui/useLongPress';
import { courseColor } from '../model/colors';
import type { WeekOccurrence } from '../model/week';
import { blockLabel, type BlockPlacement } from './layout';

export interface CourseBlockProps {
  placement: BlockPlacement;
  weekday: Weekday;
  locale: TimetableLocale;
  pending: boolean;
  flash: boolean;
  onOpen: (occurrence: WeekOccurrence) => void;
  onMenu: (occurrence: WeekOccurrence) => void;
}

/**
 * The short code with a line-break chance between its letters and its digits, so a narrow block reads MAT / 102
 * rather than breaking inside either part.
 * 在字母与数字之间留出换行点的简短代码，窄方块因此显示为 MAT / 102，而不会在任一部分中间断开。
 */
function CodeText({ code }: { code: string }) {
  const match = /^([A-Za-z]+)(\d.*)$/.exec(code);
  if (!match) return <>{code}</>;
  return (
    <>
      {match[1]}
      <wbr />
      {match[2]}
    </>
  );
}

function CourseBlockView({ placement, weekday, locale, pending, flash, onOpen, onMenu }: CourseBlockProps) {
  const { occurrence, top, height, lane, lanes } = placement;
  const { fill, ink } = courseColor(occurrence.course.color);
  const { handlers, pressed } = useLongPress({ onLongPress: () => onMenu(occurrence) });
  const style = {
    top: `calc(var(--tt-hour) * ${top} + 1px)`,
    height: `calc(var(--tt-hour) * ${height} - 2px)`,
    left: `calc(${(lane * 100) / lanes}% + 1px)`,
    width: `calc(${100 / lanes}% - 2px)`,
    '--tt-fill': fill,
    '--tt-ink': ink,
  } as CSSProperties;
  const label = pending ? `${blockLabel(occurrence, weekday, locale)}${locale === 'en' ? ', not synced' : '，待同步'}` : blockLabel(occurrence, weekday, locale);
  return (
    <button
      type="button"
      data-block={`${occurrence.meeting.id}|${occurrence.date}`}
      className={`tt-block${lanes > 1 ? ' is-narrow' : ''}${occurrence.skipped ? ' is-skipped' : ''}${pressed ? ' is-pressed' : ''}${flash ? ' tt-flash' : ''}`}
      style={style}
      aria-label={label}
      onClick={() => onOpen(occurrence)}
      {...handlers}
    >
      <span className="tt-block-code" aria-hidden>
        <CodeText code={shortCode(occurrence.course.code)} />
      </span>
      {occurrence.skipped ? (
        <span className="tt-block-loc" aria-hidden>
          {locale === 'en' ? 'Skipped' : '已停课'}
        </span>
      ) : occurrence.meeting.location ? (
        <span className="tt-block-loc" aria-hidden>
          {occurrence.meeting.location}
        </span>
      ) : null}
      {occurrence.conflict ? (
        <span className="tt-block-badge" aria-hidden>
          !
        </span>
      ) : null}
      {pending ? <span className="tt-block-dot" aria-hidden /> : null}
    </button>
  );
}

export const CourseBlock = memo(CourseBlockView);
