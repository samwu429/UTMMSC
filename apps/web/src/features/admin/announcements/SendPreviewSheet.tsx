import { useEffect, useId, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTr } from '../../../shared/i18n/locale';
import { Button } from '../../../shared/ui/Button';
import { useBackToClose } from '../../../shared/ui/overlayHistory';

export interface SendPreviewSheetProps {
  /** The question on top, such as 发送给 {n} 位成员？ */
  /** 顶部的问题，例如「发送给 {n} 位成员？」 */
  heading: string;
  title: string;
  /** The first lines of the message. */
  /** 正文的开头几行。 */
  lines: readonly string[];
  onSend: () => void;
  onCancel: () => void;
}

/**
 * The last look before an email goes to every active member: how many, the title and the first lines, then 发送. It
 * cannot be taken back, so focus starts on 取消. A bottom sheet on phones and a centred card on desktop; back, Esc and
 * a tap outside cancel.
 * 邮件发给全体在用成员之前的最后确认：多少人、标题和正文开头，然后是「发送」。发出后无法撤回，因此焦点先落在「取消」上。手机上是底部弹出层，
 * 桌面上是居中的卡片；返回、Esc 和点按外部表示取消。
 */
export function SendPreviewSheet({ heading, title, lines, onSend, onCancel }: SendPreviewSheetProps) {
  const tr = useTr();
  const headingId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef(onCancel);
  const pressStartedOnBackdrop = useRef(false);
  useLayoutEffect(() => {
    cancelRef.current = onCancel;
  });
  useBackToClose(onCancel);

  useEffect(() => {
    // The first button is 取消.
    // 第一个按钮是「取消」。
    dialogRef.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
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
      onPointerDown={(event) => {
        pressStartedOnBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && pressStartedOnBackdrop.current) onCancel();
        pressStartedOnBackdrop.current = false;
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className="wx-slide-up w-full max-w-2xl rounded-t-2xl bg-white px-4 pt-3 lg:max-w-md lg:rounded-2xl lg:px-6 lg:pt-6"
        style={{ paddingBottom: 'max(1.25rem, var(--safe-bottom))' }}
      >
        <div aria-hidden className="mx-auto mb-3 h-1 w-10 rounded-full bg-stone-200 lg:hidden" />
        <h2 id={headingId} className="text-[17px] font-semibold text-brand-800">
          {heading}
        </h2>
        <p className="mt-1.5 text-[14px] leading-relaxed text-stone-600">{tr('邮件发出后无法撤回。', "Once the email is sent it can't be taken back.")}</p>
        <div className="mt-3 rounded-lg bg-stone-50 px-3.5 py-3 ring-1 ring-inset ring-stone-200">
          <p className="break-words text-[15px] font-semibold leading-6 text-wx-ink">{title}</p>
          {lines.map((line, index) => (
            <p key={index} className="mt-1 break-words text-[14px] leading-6 text-stone-700">
              {line}
            </p>
          ))}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={onCancel}>
            {tr('取消', 'Cancel')}
          </Button>
          <Button onClick={onSend}>{tr('发送', 'Send')}</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
