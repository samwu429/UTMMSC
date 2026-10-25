/**
 * Owner: T3, timetable web core. The timetable's icons, drawn in currentColor with the same line weight as the
 * chat and 好友动态 icons.
 * 维护者：T3，课表网页核心。课表使用的图标，以 currentColor 绘制，线宽与聊天和好友动态的图标一致。
 */
import type { ReactNode } from 'react';

const LINE = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

function Icon({ children, className }: { children: ReactNode; className: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...LINE} aria-hidden>
      {children}
    </svg>
  );
}

export function PlusIcon({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  );
}

/** ⋯ */
export function MoreIcon({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <circle cx="5.5" cy="12" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="18.5" cy="12" r="1.7" />
    </svg>
  );
}

export function ChevronLeftIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="m14 6-6 6 6 6" />
    </Icon>
  );
}

export function ChevronRightIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="m10 6 6 6-6 6" />
    </Icon>
  );
}

export function ChevronDownIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  );
}

/** The tick circle of an assignment row: empty while open, filled once done. */
/** 作业行的勾选圆圈：未完成时为空心，完成后为实心。 */
export function TickCircle({ done, className = 'h-6 w-6' }: { done: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <circle cx="12" cy="12" r="9.2" fill={done ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6" />
      {done ? <path d="m7.8 12.3 2.8 2.8 5.6-5.8" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /> : null}
    </svg>
  );
}

export function BellIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 1.5H5l1.5-1.5Z" />
      <path d="M10 20.5a2 2 0 0 0 4 0" />
    </Icon>
  );
}

export function CloseIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />
    </Icon>
  );
}
