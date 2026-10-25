import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTr } from '../../../shared/i18n/locale';
import { Button } from '../../../shared/ui/Button';
import { useBackToClose } from '../../../shared/ui/overlayHistory';
import { overlayOpened } from './overlayGate';

/**
 * Whether what was typed matches the name to confirm: the same text apart from spaces at either end, in either
 * Unicode form, so a name typed with an IME composes to a match.
 * 输入的内容是否与要确认的名称一致：除两端空格外文字相同，Unicode 组合形式不同也算一致，因此用输入法打出的名称可以匹配。
 */
export function matchesTyped(typed: string, expected: string): boolean {
  const want = expected.normalize('NFC').trim();
  return want.length > 0 && typed.normalize('NFC').trim() === want;
}

export interface TypedConfirmSheetProps {
  title: string;
  body: string;
  /** What has to be typed, such as the channel name. */
  /** 需要输入的内容，例如频道名称。 */
  expected: string;
  /** The field's label, such as 输入频道名称以确认. */
  /** 输入框的标签，例如「输入频道名称以确认」。 */
  inputLabel: string;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * For actions that destroy data (删除频道): the consequence, a field that must match the name, and a red button that
 * stays off until it does, the GitHub and Discord pattern. A bottom sheet on phones and a centred dialog on desktop;
 * the system back gesture and Esc cancel. Render it while open; unmounting closes it.
 * 用于会销毁数据的操作（删除频道）：说明后果，提供一个必须与名称一致的输入框，以及在一致之前保持不可用的红色按钮，即 GitHub 和 Discord
 * 的做法。手机上是底部弹出层，桌面上是居中的对话框；系统返回手势和 Esc 表示取消。打开期间渲染它，卸载即关闭。
 */
export function TypedConfirmSheet({ title, body, expected, inputLabel, confirmLabel, busy = false, onConfirm, onCancel }: TypedConfirmSheetProps) {
  const tr = useTr();
  const [typed, setTyped] = useState('');
  const titleId = useId();
  const bodyId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(onCancel);
  useLayoutEffect(() => {
    cancelRef.current = onCancel;
  });
  const ready = matchesTyped(typed, expected);

  useBackToClose(() => cancelRef.current());
  useEffect(() => overlayOpened(), []);

  useEffect(() => {
    // A fine pointer means a keyboard is at hand; on touch screens the keyboard waits for a tap on the field.
    // 精确指针意味着手边有键盘；触屏上等成员点按输入框再弹出键盘。
    if (window.matchMedia?.('(pointer: fine)').matches) inputRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      cancelRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return createPortal(
    <div
      className="wx-fade fixed inset-0 z-[70] flex items-end justify-center bg-black/40 lg:items-center lg:p-6"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className="wx-slide-up w-full max-w-2xl rounded-t-2xl bg-white px-4 pt-3 lg:max-w-md lg:rounded-2xl lg:px-6 lg:pt-6"
        style={{ paddingBottom: 'max(1.25rem, var(--safe-bottom))' }}
      >
        <div aria-hidden className="mx-auto mb-3 h-1 w-10 rounded-full bg-stone-200 lg:hidden" />
        <h2 id={titleId} className="text-[17px] font-semibold text-brand-800">
          {title}
        </h2>
        <p id={bodyId} className="mt-2 text-[14px] leading-relaxed text-stone-600">
          {body}
        </p>
        <form
          className="mt-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (ready && !busy) onConfirm();
          }}
        >
          <label className="block">
            <span className="text-[13px] font-medium text-stone-600">{inputLabel}</span>
            <input
              ref={inputRef}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="done"
              placeholder={expected}
              className="mt-1.5 w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-[16px] text-stone-900 outline-none focus:border-brand-800 focus:ring-2 focus:ring-brand-100"
            />
          </label>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
              {tr('取消', 'Cancel')}
            </Button>
            <button
              type="submit"
              disabled={!ready || busy}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-wx-red px-4 py-2.5 text-[15px] font-medium text-white disabled:cursor-not-allowed disabled:bg-red-200"
            >
              {busy ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : null}
              {confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
