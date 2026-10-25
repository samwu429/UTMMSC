import { Children, Fragment, type MouseEvent, type ReactNode } from 'react';
import { Link, type To } from 'react-router-dom';
import { UnreadDot } from '../../chat/components/UnreadDot';
import { useInsetGroups } from '../layout/media';
import { AdminIcon } from './icons';

/**
 * WeChat 设置 / 群管理 building blocks, modelled on chat/info/InfoCell: white groups of cells on the gray canvas.
 * Full-bleed on phones and in the narrow list pane; rounded cards on desktop.
 * 仿微信「设置 / 群管理」的基础组件，参照 chat/info/InfoCell：灰色底上的白色单元格分组。手机上和较窄的列表栏中为通栏，桌面上为圆角卡片。
 */

/** Where the hairline between cells starts: under the text, or past a 32px icon tile or a 40px avatar. */
/** 单元格之间分隔线的起点：文字下方，或越过 32px 图块、40px 头像之后。 */
export type CellInset = 'text' | 'icon' | 'avatar' | 'none';

const LINE_INSET: Record<CellInset, string> = {
  text: 'ml-4',
  icon: 'ml-[60px]',
  avatar: 'ml-[68px]',
  none: '',
};

export function AdminGroup({
  title,
  footer,
  children,
  inset = 'text',
  id,
}: {
  title?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  inset?: CellInset;
  id?: string;
}) {
  const insetGroups = useInsetGroups();
  const items = Children.toArray(children);
  const side = insetGroups ? 'px-1' : 'px-4';
  return (
    <section className={insetGroups ? 'mt-5 first:mt-0' : 'mt-2'} aria-labelledby={title && id ? id : undefined}>
      {title ? (
        <h2 id={id} className={`${side} pb-1.5 pt-2 text-[13px] leading-5 text-wx-meta`}>
          {title}
        </h2>
      ) : null}
      {items.length > 0 ? (
        <div className={`bg-white ${insetGroups ? 'overflow-hidden rounded-xl ring-1 ring-black/[0.06]' : ''}`}>
          {items.map((child, index) => (
            <Fragment key={index}>
              {index > 0 ? <div aria-hidden className={`h-[0.5px] bg-wx-line ${LINE_INSET[inset]}`} /> : null}
              {child}
            </Fragment>
          ))}
        </div>
      ) : null}
      {footer ? <div className={`${side} pt-1.5 text-[13px] leading-relaxed text-wx-meta`}>{footer}</div> : null}
    </section>
  );
}

export interface AdminCellProps {
  label: ReactNode;
  /** A second line under the label. */
  /** 标签下方的第二行。 */
  detail?: ReactNode;
  /** An icon tile or avatar at the start. */
  /** 行首的图块或头像。 */
  leading?: ReactNode;
  /** Short value at the end, in gray. */
  /** 行尾的简短取值，灰色。 */
  value?: ReactNode;
  /** A StatusBadge before the value. */
  /** 取值之前的 StatusBadge。 */
  badge?: ReactNode;
  /** A red count, for waiting work. */
  /** 红色计数，表示待处理的事项。 */
  count?: number;
  /** A control at the end, such as a switch. */
  /** 行尾的控件，例如开关。 */
  trailing?: ReactNode;
  to?: To;
  state?: unknown;
  replace?: boolean;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  /** A centred red action in its own group, such as 停用账号. */
  /** 单独一组、居中的红色操作，例如「停用账号」。 */
  danger?: boolean;
  /** The item shown in the detail pane of a split view. */
  /** 分栏视图中详情栏正在显示的项目。 */
  selected?: boolean;
  /** Defaults to true for links and buttons. */
  /** 链接和按钮默认为 true。 */
  chevron?: boolean;
  /** Read by screen readers after the label, for example the spoken count. */
  /** 读屏软件在标签之后读出的文字，例如计数。 */
  spoken?: string;
  /** Marks the row for ↑/↓ navigation (see listKeyboard.ts). */
  /** 标记该行用于 ↑/↓ 键导航（见 listKeyboard.ts）。 */
  rowId?: string;
  /** Long lists: let the browser skip drawing rows off screen. */
  /** 长列表：让浏览器跳过绘制屏幕外的行。 */
  lazy?: boolean;
  disabled?: boolean;
  /** Bulk selection: the row toggles a check instead of opening. */
  /** 批量选择：点按该行切换勾选，而不是打开。 */
  checkbox?: { checked: boolean; onChange: (next: boolean) => void };
}

function CheckCircle({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-[1.5px] ${checked ? 'border-brand-700 bg-brand-700 text-white' : 'border-stone-300 bg-white text-transparent'}`}
    >
      <AdminIcon name="check" className="h-4 w-4" strokeWidth={2.25} />
    </span>
  );
}

const ROW = 'relative block w-full text-left outline-offset-[-2px]';
const LAZY = '[content-visibility:auto] [contain-intrinsic-size:auto_64px]';

/**
 * One cell: optional leading tile or avatar, a 17px label with an optional detail line, then value, badge, count,
 * control and chevron at the end. Links, buttons, static rows, a danger action, a selected row in a split view, or a
 * checkbox row for bulk actions.
 * 一个单元格：可选的行首图块或头像，17px 的标签及可选的说明行，行尾依次为取值、标记、计数、控件和箭头。可以是链接、按钮、静态行、
 * 危险操作、分栏视图中的选中行，或批量操作用的勾选行。
 */
export function AdminCell({
  label,
  detail,
  leading,
  value,
  badge,
  count,
  trailing,
  to,
  state,
  replace,
  onClick,
  danger = false,
  selected = false,
  chevron,
  spoken,
  rowId,
  lazy = false,
  disabled = false,
  checkbox,
}: AdminCellProps) {
  const interactive = !disabled && Boolean(to || onClick || checkbox);
  const showChevron = !checkbox && (chevron ?? Boolean(to || onClick)) && !danger;
  const pressed = interactive ? 'active:bg-wx-pressed' : '';
  const tone = selected ? 'bg-brand-50' : '';
  const extra = `${lazy ? LAZY : ''} ${disabled ? 'opacity-50' : ''}`;

  const content = danger ? (
    <span className="flex min-h-14 w-full items-center justify-center px-4 text-[17px] text-wx-red">{label}</span>
  ) : (
    <span className="flex min-h-14 items-center gap-3 px-4 py-2.5">
      {checkbox ? <CheckCircle checked={checkbox.checked} /> : null}
      {leading}
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[17px] leading-6 ${selected ? 'font-medium text-brand-800' : 'text-wx-ink'}`}>
          {label}
          {spoken ? <span className="sr-only">{spoken}</span> : null}
        </span>
        {detail !== undefined && detail !== null ? <span className="mt-0.5 block truncate text-[14px] leading-5 text-wx-meta">{detail}</span> : null}
      </span>
      {badge}
      {value !== undefined && value !== null ? <span className="max-w-[48%] shrink-0 truncate text-right text-[15px] text-wx-meta">{value}</span> : null}
      {count ? <UnreadDot count={count} /> : null}
      {trailing}
      {showChevron ? <AdminIcon name="chevron" className="h-4 w-4 shrink-0 text-stone-400" strokeWidth={2} /> : null}
      {selected ? <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-gold" /> : null}
    </span>
  );

  if (checkbox && !disabled) {
    return (
      <button
        type="button"
        role="checkbox"
        aria-checked={checkbox.checked}
        data-admin-row={rowId}
        onClick={() => checkbox.onChange(!checkbox.checked)}
        className={`${ROW} ${pressed} ${extra}`}
      >
        {content}
      </button>
    );
  }
  if (to && !disabled) {
    return (
      <Link
        to={to}
        state={state}
        replace={replace}
        onClick={onClick}
        aria-current={selected ? 'true' : undefined}
        data-admin-row={rowId}
        className={`${ROW} ${pressed} ${tone} ${extra}`}
      >
        {content}
      </Link>
    );
  }
  if (onClick && !disabled) {
    return (
      <button type="button" onClick={onClick} data-admin-row={rowId} className={`${ROW} ${pressed} ${tone} ${extra}`}>
        {content}
      </button>
    );
  }
  return (
    <div className={`${ROW} ${tone} ${extra}`} aria-disabled={disabled || undefined}>
      {content}
    </div>
  );
}

/**
 * A read-only label and value on one row, the value wrapping onto more lines when long (an email, a note), as in
 * WeChat's 个人信息. For details such as an application.
 * 同一行中只读的标签和取值，取值较长时（邮箱、说明）换行显示，与微信「个人信息」一致。用于申请等详情。
 */
export function AdminField({ label, children, multiline = false }: { label: ReactNode; children: ReactNode; multiline?: boolean }) {
  return (
    <div className={`flex min-h-14 gap-4 px-4 py-3.5 ${multiline ? 'flex-col gap-1.5 sm:flex-row sm:gap-4' : 'items-start'}`}>
      <span className="w-[5.5rem] shrink-0 text-[16px] leading-6 text-wx-meta">{label}</span>
      <span className={`min-w-0 flex-1 text-[16px] leading-6 text-wx-ink [overflow-wrap:anywhere] ${multiline ? 'whitespace-pre-wrap' : ''}`}>{children}</span>
    </div>
  );
}
