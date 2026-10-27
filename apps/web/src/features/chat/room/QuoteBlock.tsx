import type { QuotePreview } from '@utmmsc/shared';
import { useTr } from '../../../shared/i18n/locale';
import { imageLabel, stickerLabel, type Translate } from '../format/systemText';

/**
 * The body a live quote shows: the localized sticker label for a sticker (its excerpt is the fallback for old
 * clients), else the excerpt, else the photo label.
 * 有效引用显示的正文：表情显示本地化的表情标签（其摘录是给旧客户端的后备文字），否则显示摘录，再否则显示图片标签。
 */
export function quoteBody(quote: QuotePreview, tr: Translate): string {
  if (quote.hasSticker) return stickerLabel(tr);
  return quote.excerpt || (quote.hasImage ? imageLabel(tr) : '');
}

export function quoteText(quote: QuotePreview, tr: Translate): string {
  switch (quote.state) {
    case 'recalled':
      return tr('引用内容已撤回', 'Quoted message was recalled');
    case 'deleted':
      return tr('引用内容已删除', 'Quoted message was deleted');
    case 'unavailable':
      return tr('引用内容不可见', 'Quoted message is not available');
    default: {
      const name = quote.authorName.trim() || tr('成员', 'Member');
      const body = quoteBody(quote, tr);
      return tr(`${name}：${body}`, `${name}: ${body}`);
    }
  }
}

/**
 * Gray block under a reply bubble showing what it quotes. Only a live quote can be tapped, which
 * jumps to the original message.
 * 回复气泡下方显示所引用内容的灰色块。只有仍有效的引用可以点按，点按后跳到原消息。
 */
export function QuoteBlock({ quote, onJump }: { quote: QuotePreview; onJump?: (id: number) => void }) {
  const tr = useTr();
  const text = quoteText(quote, tr);
  const className = 'mt-1 max-w-full rounded-[4px] bg-wx-quote px-2 py-1.5 text-left text-[13px] leading-[18px] text-wx-quoteInk';
  const body = <span className="line-clamp-2 break-words [overflow-wrap:anywhere]">{text}</span>;
  if (quote.state === 'ok' && onJump) {
    return (
      <button type="button" className={`${className} active:bg-wx-line`} onClick={() => onJump(quote.id)} data-interactive>
        {body}
      </button>
    );
  }
  return <div className={className}>{body}</div>;
}
