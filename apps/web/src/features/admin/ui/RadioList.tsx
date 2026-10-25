import type { ReactNode } from 'react';
import { WxSpinner } from '../../../shared/ui/WxSpinner';
import { AdminGroup } from './AdminCell';
import { AdminIcon } from './icons';

export interface RadioItem<T extends string> {
  value: T;
  label: string;
  /** One line under the label, such as what the role may do. */
  /** 标签下方的一行，例如该身份能做什么。 */
  detail?: string;
  /** Why it can't be chosen; the row is then dimmed and says so. */
  /** 不能选择的原因；该行会变暗并显示原因。 */
  disabledReason?: string | null;
}

/**
 * A WeChat choice screen: one group of rows, a brand check on the chosen one. Choosing a row reports it at once
 * (the screen saves or asks first); `busy` puts a spinner on the row being saved and holds the others.
 * 微信式的选择界面：一组行，所选的一行带品牌色勾号。选择某行会立即回报（由界面保存，或先询问）；`busy` 在正在保存的那一行显示加载动画，
 * 并暂停其他行。
 */
export function RadioList<T extends string>({
  items,
  value,
  onSelect,
  busy = null,
  title,
  footer,
  label,
}: {
  items: readonly RadioItem<T>[];
  value: T | null;
  onSelect: (value: T) => void;
  busy?: T | null;
  title?: ReactNode;
  footer?: ReactNode;
  /** The group's name for screen readers. */
  /** 读屏软件读出的分组名称。 */
  label: string;
}) {
  return (
    <AdminGroup title={title} footer={footer}>
      <div role="radiogroup" aria-label={label} aria-busy={busy !== null || undefined}>
        {items.map((item, index) => {
          const checked = item.value === value;
          const disabled = Boolean(item.disabledReason) || (busy !== null && busy !== item.value);
          return (
            <div key={item.value}>
              {index > 0 ? <div aria-hidden className="ml-4 h-[0.5px] bg-wx-line" /> : null}
              <button
                type="button"
                role="radio"
                aria-checked={checked}
                aria-disabled={disabled || undefined}
                onClick={() => {
                  if (!disabled && !checked && busy === null) onSelect(item.value);
                }}
                className={`flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left outline-offset-[-2px] ${disabled ? 'cursor-default' : 'active:bg-wx-pressed'}`}
              >
                <span className="min-w-0 flex-1">
                  <span className={`block text-[17px] leading-6 ${item.disabledReason ? 'text-stone-400' : 'text-wx-ink'}`}>{item.label}</span>
                  {item.disabledReason ? (
                    <span className="mt-0.5 block text-[13px] leading-5 text-wx-meta">{item.disabledReason}</span>
                  ) : item.detail ? (
                    <span className="mt-0.5 block text-[13px] leading-5 text-wx-meta">{item.detail}</span>
                  ) : null}
                </span>
                {busy === item.value ? (
                  <WxSpinner size={20} />
                ) : checked ? (
                  <AdminIcon name="check" className="h-5 w-5 shrink-0 text-brand-700" strokeWidth={2.25} />
                ) : (
                  <span aria-hidden className="h-5 w-5 shrink-0" />
                )}
              </button>
            </div>
          );
        })}
      </div>
    </AdminGroup>
  );
}
