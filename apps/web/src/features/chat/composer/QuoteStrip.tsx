import type { PointerEvent } from 'react';
import type { QuotePreview } from '@utmmsc/shared';
import { useTr } from '../../../shared/i18n/locale';
import { imageLabel } from '../format/systemText';
import { CloseCircleIcon, ImageTileIcon } from './composerIcons';

function keepFocus(event: PointerEvent) {
  // Keeps the keyboard up: the textarea must not lose focus to this button.
  // 保持键盘弹出：文本框不能把焦点让给这个按钮。
  event.preventDefault();
}

/** The message being replied to, shown in one line directly above the input row until it is sent or removed. */
/** 正在回复的消息，以一行显示在输入行正上方，直到发送或被取消。 */
export function QuoteStrip({ quote, onCancel }: { quote: QuotePreview; onCancel: () => void }) {
  const tr = useTr();
  const name = quote.authorName.trim() || tr('成员', 'Member');
  const body = quote.excerpt.replace(/\s+/g, ' ').trim() || (quote.hasImage ? imageLabel(tr) : '');
  const line = tr(`${name}：${body}`, `${name}: ${body}`);
  return (
    <div className="flex items-center gap-1 pl-2.5 pt-2">
      <div className="flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-[4px] bg-wx-quote px-2.5 py-1.5">
        <p className="min-w-0 flex-1 truncate text-[13px] leading-snug text-wx-quoteInk">{line}</p>
        {quote.hasImage ? <ImageTileIcon className="h-6 w-6 shrink-0" /> : null}
      </div>
      <button
        type="button"
        onPointerDown={keepFocus}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onCancel}
        className="flex h-11 w-11 shrink-0 items-center justify-center text-wx-meta/50 active:text-wx-meta"
        aria-label={tr('取消引用', 'Remove quote')}
      >
        <CloseCircleIcon />
      </button>
    </div>
  );
}
