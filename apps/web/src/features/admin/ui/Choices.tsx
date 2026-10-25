import { useRef, type KeyboardEvent } from 'react';
import { useTr } from '../../../shared/i18n/locale';

export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
  /** Shown after the label; null or undefined shows none. */
  /** 显示在标签之后；为 null 或 undefined 时不显示。 */
  count?: number | null;
}

/** ←/→ (and ↑/↓) move between the options of a group and choose, Home and End jump to the ends. */
/** ←/→（以及 ↑/↓）在一组选项之间移动并选择，Home 和 End 跳到两端。 */
function useRoving<T extends string>(options: readonly ChoiceOption<T>[], value: T, onChange: (next: T) => void) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = -1;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % options.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + options.length) % options.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = options.length - 1;
    if (next < 0) return;
    event.preventDefault();
    event.stopPropagation();
    const option = options[next];
    if (!option) return;
    refs.current[next]?.focus();
    if (option.value !== value) onChange(option.value);
  }
  return { refs, onKeyDown };
}

/**
 * Single-choice chips with counts, in a row that scrolls sideways (?f= filters). The pill is 36px; the touch target
 * around it is 44px.
 * 带计数的单选标签，排成一行、可横向滚动（?f= 筛选）。胶囊高 36px，外围的触控区域为 44px。
 */
export function FilterChips<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly ChoiceOption<T>[];
  value: T;
  onChange: (next: T) => void;
  label: string;
}) {
  const { refs, onKeyDown } = useRoving(options, value, onChange);
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1.5 overflow-x-auto px-3 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(element) => {
              refs.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className="flex min-h-11 shrink-0 items-center outline-offset-0"
          >
            <span
              className={`flex h-9 items-center gap-1 whitespace-nowrap rounded-full px-3.5 text-[14px] ${
                selected ? 'bg-brand-800 font-medium text-white' : 'bg-white text-stone-700 ring-1 ring-inset ring-stone-200 active:bg-stone-50'
              }`}
            >
              {option.label}
              {option.count !== undefined && option.count !== null ? <span className={`tabular-nums ${selected ? 'text-white/80' : 'text-stone-400'}`}>{option.count}</span> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Segments for views of one list (待处理 / 已移除 / 已驳回), with the tablist roles. Taken from the moment reports
 * panel's segment style.
 * 同一列表不同视图的分段控件（待处理 / 已移除 / 已驳回），使用 tablist 角色。样式取自动态投诉面板的分段控件。
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly ChoiceOption<T>[];
  value: T;
  onChange: (next: T) => void;
  label: string;
}) {
  const tr = useTr();
  const { refs, onKeyDown } = useRoving(options, value, onChange);
  return (
    <div
      role="tablist"
      aria-label={label}
      className="grid gap-1 rounded-lg bg-stone-200/70 p-1"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(element) => {
              refs.current[index] = element;
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={`min-h-10 truncate rounded-md px-2 text-[14px] ${selected ? 'bg-white font-medium text-brand-800 shadow-sm' : 'text-stone-600 active:bg-white/50'}`}
          >
            {option.label}
            {option.count !== undefined && option.count !== null ? <span className="tabular-nums">{tr(`（${option.count}）`, ` (${option.count})`)}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
