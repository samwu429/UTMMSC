import { forwardRef, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTr } from '../../../shared/i18n/locale';
import { useIsDesktop } from '../layout/media';
import { AdminIcon } from './icons';

export const SEARCH_DEBOUNCE_MS = 150;

interface Props {
  /** The committed query, usually ?q= from the address. */
  /** 已提交的查询，通常来自地址中的 ?q=。 */
  value: string;
  /** Called 150ms after typing stops, and at once when cleared. */
  /** 停止输入 150 毫秒后调用；清空时立即调用。 */
  onChange: (value: string) => void;
  placeholder: string;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
}

/**
 * The gray rounded search field under a list's header, with a clear button. Text is 16px so iOS does not zoom; on
 * desktop it shows the / shortcut that focuses it.
 * 列表标题栏下方的灰色圆角搜索框，带清除按钮。文字为 16px，iOS 不会缩放；桌面上显示聚焦它的快捷键 /。
 */
export const SearchBar = forwardRef<HTMLInputElement, Props>(function SearchBar({ value, onChange, placeholder, onKeyDown }, ref) {
  const tr = useTr();
  const desktop = useIsDesktop();
  const [text, setText] = useState(value);
  const emitted = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChangeRef = useRef(onChange);
  useLayoutEffect(() => {
    onChangeRef.current = onChange;
  });

  // A change from outside (back, a link) replaces the text; the query this field sent itself does not.
  // 来自外部的变化（返回、链接）会替换文字；本输入框自己发出的查询不会。
  useEffect(() => {
    if (value === emitted.current) return;
    emitted.current = value;
    setText(value);
  }, [value]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function emit(next: string) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    emitted.current = next;
    onChangeRef.current(next);
  }

  function type(next: string) {
    setText(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => emit(next), SEARCH_DEBOUNCE_MS);
  }

  return (
    <div className="bg-white px-3 pb-2 pt-1.5">
      <label className="flex h-10 items-center gap-2 rounded-lg bg-stone-100 px-2.5 text-stone-500 focus-within:ring-2 focus-within:ring-brand-100">
        <AdminIcon name="search" className="h-[18px] w-[18px] shrink-0" />
        <input
          ref={ref}
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          spellCheck={false}
          value={text}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(event) => type(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') emit(text);
            if (event.key === 'Escape' && text) {
              event.preventDefault();
              event.stopPropagation();
              setText('');
              emit('');
              return;
            }
            onKeyDown?.(event);
          }}
          className="min-w-0 flex-1 bg-transparent text-[16px] text-stone-900 outline-none placeholder:text-stone-400 [&::-webkit-search-cancel-button]:hidden"
        />
        {text ? (
          <button
            type="button"
            onClick={() => {
              setText('');
              emit('');
            }}
            aria-label={tr('清除搜索', 'Clear search')}
            className="-mr-1.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-stone-400 active:text-stone-600"
          >
            <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-stone-400 text-white">
              <AdminIcon name="close" className="h-3 w-3" strokeWidth={2.5} />
            </span>
          </button>
        ) : desktop ? (
          <kbd className="shrink-0 rounded border border-stone-300 px-1.5 font-sans text-[12px] leading-5 text-stone-400" aria-hidden>
            /
          </kbd>
        ) : null}
      </label>
    </div>
  );
});
