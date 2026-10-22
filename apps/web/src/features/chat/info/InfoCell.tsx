import { Children, Fragment, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

function CellChevron() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-stone-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m9 5 7 7-7 7" />
    </svg>
  );
}

/**
 * A white group of cells with hairlines inset from the left, separated from the group above by the canvas.
 * `flush` drops that gap for the first group under the title bar.
 * 一组白色单元格，分隔线从左侧缩进，与上一组之间露出底色。`flush` 用于标题栏下的第一组，去掉这段间隔。
 */
export function InfoGroup({ children, flush = false }: { children: ReactNode; flush?: boolean }) {
  const items = Children.toArray(children);
  return (
    <section className={`bg-white ${flush ? '' : 'mt-2'}`}>
      {items.map((child, index) => (
        <Fragment key={index}>
          {index > 0 ? <div aria-hidden className="ml-4 h-[0.5px] bg-wx-line" /> : null}
          {child}
        </Fragment>
      ))}
    </section>
  );
}

interface InfoCellProps {
  label: string;
  labelId?: string;
  /** Short value at the right end of the row. */
  /** 行尾的简短取值。 */
  value?: ReactNode;
  /** Longer text under the label, such as a channel notice. */
  /** 标签下方的较长文字，例如频道公告。 */
  detail?: ReactNode;
  /** A control at the right end, such as a switch. */
  /** 行尾的控件，例如开关。 */
  trailing?: ReactNode;
  to?: string;
  onClick?: () => void;
  danger?: boolean;
}

/**
 * One WeChat settings row: a label with a value, a control or a chevron at the right. A danger row is a
 * centred red action.
 * 一行微信式设置：左侧是标签，右侧是取值、控件或箭头。危险操作行为居中的红色文字。
 */
export function InfoCell({ label, labelId, value, detail, trailing, to, onClick, danger = false }: InfoCellProps) {
  const interactive = Boolean(to || onClick);
  const content = danger ? (
    <span className="flex min-h-14 w-full items-center justify-center px-4 text-[17px] text-wx-red">{label}</span>
  ) : (
    <span className="flex min-h-14 w-full flex-col justify-center gap-1 px-4 py-3">
      <span className="flex items-center gap-3">
        <span id={labelId} className="shrink-0 text-[17px] leading-6 text-wx-ink">
          {label}
        </span>
        <span className="flex min-w-0 flex-1 items-center justify-end gap-1">
          {value !== undefined ? <span className="min-w-0 truncate text-right text-[16px] text-wx-meta">{value}</span> : null}
          {trailing}
          {interactive ? <CellChevron /> : null}
        </span>
      </span>
      {detail !== undefined ? <span className="whitespace-pre-wrap break-words text-[14px] leading-5 text-wx-meta">{detail}</span> : null}
    </span>
  );

  const rowClass = 'block w-full text-left active:bg-wx-pressed';
  if (to) {
    return (
      <Link to={to} className={rowClass}>
        {content}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={rowClass}>
        {content}
      </button>
    );
  }
  return <div>{content}</div>;
}
