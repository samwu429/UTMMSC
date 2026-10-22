import { useEffect, useState } from 'react';
import { useTr } from '../../../shared/i18n/locale';
import { useConfirm } from '../../../shared/ui/confirm';
import { WxSpinner } from '../../../shared/ui/WxSpinner';
import type { PendingMessage } from './types';

/** A send that is confirmed this quickly never shows the spinner, so ordinary sends do not flicker. */
/** 在这段时间内就被确认的发送不会显示加载图标，普通发送因此不会闪烁。 */
const SPINNER_DELAY_MS = 300;

/**
 * State of your own pending message, drawn to the left of its bubble: a gray spinner while it is on its
 * way, or a red ! that offers to resend once it has failed.
 * 自己待发消息的状态，显示在气泡左侧：发送途中为灰色加载图标，失败后为红色感叹号，点按可重发。
 */
export function SendStatus({ status, onResend }: { status: PendingMessage['status']; onResend: () => void }) {
  const tr = useTr();
  const ask = useConfirm();
  const failed = status === 'failed';
  const [spinnerShown, setSpinnerShown] = useState(false);

  useEffect(() => {
    if (failed) return;
    const timer = setTimeout(() => setSpinnerShown(true), SPINNER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [failed]);

  async function resend() {
    const ok = await ask({ title: tr('重发该消息？', 'Resend this message?'), confirmLabel: tr('重发', 'Resend') });
    if (ok) onResend();
  }

  if (failed) {
    return (
      <button
        type="button"
        onClick={() => void resend()}
        className="flex h-11 w-11 items-center justify-center"
        aria-label={tr('发送失败，点按重发', 'Not sent. Tap to resend')}
        data-interactive
      >
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-wx-red text-[13px] font-bold leading-none text-white" aria-hidden>
          !
        </span>
      </button>
    );
  }
  if (!spinnerShown) return null;
  return (
    <span className="flex h-11 w-11 items-center justify-center">
      <WxSpinner size={16} label={tr('正在发送', 'Sending')} />
    </span>
  );
}
