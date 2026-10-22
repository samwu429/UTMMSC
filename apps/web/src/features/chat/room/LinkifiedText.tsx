import { memo, useMemo, useState, type SyntheticEvent } from 'react';
import { useTr } from '../../../shared/i18n/locale';
import { ActionSheet } from '../../../shared/ui/ActionSheet';
import { toast } from '../../../shared/ui/toast';
import { linkify } from './linkify';
import { copyText } from './MessagePopover';

function stop(event: SyntheticEvent) {
  event.stopPropagation();
}

/**
 * Message text with web links, email addresses and phone numbers made tappable. It renders React nodes
 * only, never HTML. Links on your own gold bubble use brand purple, which keeps 4.5:1 contrast there.
 * 把消息中的网址、邮箱和电话号码变为可点按的文字。只渲染 React 节点，从不插入 HTML。
 * 自己的金色气泡上的链接使用品牌紫色，在该底色上仍保持 4.5:1 对比度。
 */
export const LinkifiedText = memo(function LinkifiedText({ text, own }: { text: string; own: boolean }) {
  const tr = useTr();
  const segments = useMemo(() => linkify(text), [text]);
  const [phone, setPhone] = useState<{ text: string; href: string } | null>(null);
  const linkClass = own ? 'text-brand-700 underline' : 'text-wx-link';

  return (
    <>
      {segments.map((segment, index) => {
        if (segment.type === 'text') return segment.text;
        if (segment.type === 'phone') {
          return (
            <button key={index} type="button" className={`${linkClass} [overflow-wrap:anywhere]`} onClick={() => setPhone(segment)} data-interactive>
              {segment.text}
            </button>
          );
        }
        return (
          <a key={index} href={segment.href} target="_blank" rel="noopener noreferrer nofollow" className={`${linkClass} [overflow-wrap:anywhere]`} data-interactive>
            {segment.text}
          </a>
        );
      })}
      {phone ? (
        // React events from the portal still bubble through the bubble's long-press handlers; stop them here.
        // 浮层内的 React 事件仍会冒泡经过气泡的长按处理；在这里拦下。
        <span onPointerDown={stop} onPointerMove={stop} onContextMenu={stop} onClick={stop}>
          <ActionSheet
            title={phone.text}
            onClose={() => setPhone(null)}
            options={[
              {
                label: tr('呼叫', 'Call'),
                onSelect: () => {
                  window.location.href = phone.href;
                },
              },
              {
                label: tr('复制号码', 'Copy number'),
                onSelect: () => {
                  void copyText(phone.text).then((ok) => toast(ok ? tr('已复制', 'Copied') : tr('复制失败', 'Couldn’t copy')));
                },
              },
            ]}
          />
        </span>
      ) : null}
    </>
  );
});
