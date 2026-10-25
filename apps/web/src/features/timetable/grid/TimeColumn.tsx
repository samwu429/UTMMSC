/**
 * Owner: T3, timetable web core. The 28 px column of hour labels, 9 to 21, each on its hour line; the first sits
 * below its line and the last above it, so neither is cut off.
 * 维护者：T3，课表网页核心。宽 28 px 的小时标签列，9 到 21，每个标签位于其整点线上；第一个在线的下方，最后一个在线的上方，都不会被截断。
 */
import { memo } from 'react';
import { GRID_HOURS } from './geometry';

const HOURS = Array.from({ length: GRID_HOURS + 1 }, (_, index) => 9 + index);

function TimeColumnView() {
  return (
    <div className="tt-time" aria-hidden>
      {HOURS.map((hour, index) => (
        <span
          key={hour}
          className={`tt-time-label${index === 0 ? ' is-first' : ''}${index === HOURS.length - 1 ? ' is-last' : ''}`}
          style={{ top: `calc(var(--tt-hour) * ${index})` }}
        >
          {hour}
        </span>
      ))}
    </div>
  );
}

export const TimeColumn = memo(TimeColumnView);
