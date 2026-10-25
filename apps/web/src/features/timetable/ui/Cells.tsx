/**
 * Owner: T3, timetable web core. WeChat-style form groups for the timetable sheets: a grey caption over a white
 * group, rows with hairlines inset from the left, a labelled field row and a switch row. The switch is the one
 * chat settings use, so both screens feel the same.
 * 维护者：T3，课表网页核心。课表面板中的微信式表单分组：白色分组上方的灰色说明、从左侧缩进的分隔线、带标签的输入行和开关行。
 * 开关与聊天设置使用同一个，因此两处的手感一致。
 */
import { Children, Fragment, useId, type ReactNode } from 'react';
import { Switch } from '../../chat/info/Switch';

export function Caption({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h3 id={id} className="px-4 pb-1.5 pt-4 text-[13px] leading-5 text-wx-meta">
      {children}
    </h3>
  );
}

/** A white group; rows are separated by hairlines inset 16 px. */
/** 白色分组；行与行之间是缩进 16 px 的分隔线。 */
export function Group({ children, caption, footer }: { children: ReactNode; caption?: ReactNode; footer?: ReactNode }) {
  const captionId = useId();
  const items = Children.toArray(children).filter(Boolean);
  return (
    <section aria-labelledby={caption ? captionId : undefined}>
      {caption ? <Caption id={captionId}>{caption}</Caption> : <div className="h-2" aria-hidden />}
      <div className="bg-white">
        {items.map((child, index) => (
          <Fragment key={index}>
            {index > 0 ? <div aria-hidden className="ml-4 h-[0.5px] bg-wx-line" /> : null}
            {child}
          </Fragment>
        ))}
      </div>
      {footer ? <p className="px-4 pt-1.5 text-[13px] leading-5 text-wx-meta">{footer}</p> : null}
    </section>
  );
}

/** Padding for free content inside a group, such as a row of chips. */
/** 分组内自由内容（例如一排选项）的内边距。 */
export function Pad({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`px-4 py-1.5 ${className}`}>{children}</div>;
}

/** A label on the left and a control on the right, at least 56 px tall. */
/** 左侧为标签、右侧为控件的一行，高度至少 56 px。 */
export function FieldRow({ label, children, htmlFor }: { label: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex min-h-14 items-center gap-3 px-4">
      <label htmlFor={htmlFor} className="w-20 shrink-0 text-[16px] text-wx-ink">
        {label}
      </label>
      <div className="flex min-w-0 flex-1 items-center justify-end gap-2">{children}</div>
    </div>
  );
}

export function SwitchRow({ label, detail, checked, onChange, disabled = false }: { label: string; detail?: ReactNode; checked: boolean; onChange: (next: boolean) => void; disabled?: boolean }) {
  const labelId = useId();
  return (
    <div className={`flex min-h-14 items-center gap-3 px-4 py-2 ${disabled ? 'opacity-50' : ''}`}>
      <span className="min-w-0 flex-1">
        <span id={labelId} className="block text-[16px] leading-6 text-wx-ink">
          {label}
        </span>
        {detail ? <span className="mt-0.5 block text-[13px] leading-5 text-wx-meta">{detail}</span> : null}
      </span>
      <Switch checked={checked} onChange={(next) => (disabled ? undefined : onChange(next))} labelledBy={labelId} />
    </div>
  );
}

/** A tappable row: a label, an optional value and a chevron; danger rows are centred red text. */
/** 可点按的一行：标签、可选的取值和箭头；危险操作为居中的红色文字。 */
export function ActionRow({ label, value, onClick, danger = false, detail }: { label: string; value?: ReactNode; onClick: () => void; danger?: boolean; detail?: ReactNode }) {
  if (danger) {
    return (
      <button type="button" onClick={onClick} className="flex min-h-14 w-full items-center justify-center px-4 text-[16px] text-wx-red active:bg-wx-pressed">
        {label}
      </button>
    );
  }
  return (
    <button type="button" onClick={onClick} className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left active:bg-wx-pressed">
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] leading-6 text-wx-ink">{label}</span>
        {detail ? <span className="mt-0.5 block text-[13px] leading-5 text-wx-meta">{detail}</span> : null}
      </span>
      {value !== undefined ? <span className="max-w-[55%] truncate text-right text-[15px] text-wx-meta">{value}</span> : null}
      <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-stone-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="m9 5 7 7-7 7" />
      </svg>
    </button>
  );
}

/** A text input styled for a white group row: no box, the value right next to its label. */
/** 适合白色分组行的文字输入框：没有边框，紧挨着标签。 */
export const ROW_INPUT = 'min-w-0 flex-1 bg-transparent py-3 text-[16px] text-wx-ink outline-none placeholder:text-stone-400';

/** A native select styled as a quiet pill. */
/** 样式低调的系统下拉框。 */
export const ROW_SELECT = 'min-h-9 rounded-md bg-wx-bar px-2 text-[16px] text-wx-ink outline-none ring-[0.5px] ring-inset ring-wx-line focus:ring-brand-700';
