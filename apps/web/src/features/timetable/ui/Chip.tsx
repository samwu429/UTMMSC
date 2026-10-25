/**
 * Owner: T3, timetable web core. Choice chips for the timetable forms: a 32 px pill inside a 44 px touch target,
 * brand-filled when chosen and announced as pressed.
 * 维护者：T3，课表网页核心。课表表单使用的选项：44 px 触控区域内的 32 px 胶囊，选中时为品牌色填充，并向读屏软件报告为已按下。
 */
import type { ReactNode } from 'react';

export interface ChipProps {
  selected?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
  /** A full name when the visible text is short, such as 一 for Monday. */
  /** 可见文字较短时的完整名称，例如「一」表示周一。 */
  label?: string;
  /** A round chip of fixed width, for weekdays and week numbers. */
  /** 固定宽度的圆形选项，用于星期和周次。 */
  round?: boolean;
  /** An action rather than a choice (复制这一行, 添加到已有课程): no pressed state. */
  /** 是操作而不是选择（复制这一行、添加到已有课程）：没有按下状态。 */
  action?: boolean;
}

export function Chip({ selected = false, disabled = false, onClick, children, label, round = false, action = false }: ChipProps) {
  const look = selected
    ? 'bg-brand-800 text-white'
    : action
      ? 'bg-wx-bar text-wx-link ring-[0.5px] ring-inset ring-wx-line'
      : 'bg-white text-wx-ink ring-[0.5px] ring-inset ring-stone-300';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={action ? undefined : selected}
      aria-label={label}
      className="group flex min-h-11 shrink-0 items-center disabled:opacity-40"
    >
      <span
        className={`flex h-8 items-center justify-center whitespace-nowrap rounded-full text-[14px] leading-none transition-colors motion-reduce:transition-none ${
          round ? 'w-9' : 'px-3'
        } ${look} ${disabled ? '' : 'group-active:opacity-80'}`}
      >
        {children}
      </span>
    </button>
  );
}

/** A wrapping row of chips with even gaps. */
/** 间距一致、可换行的一排选项。 */
export function ChipRow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`flex flex-wrap items-center gap-x-1.5 ${className}`}>{children}</div>;
}
