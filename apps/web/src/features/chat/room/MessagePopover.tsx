import { useEffect, useRef, useState, type ComponentType, type KeyboardEvent } from 'react';
import { useTr } from '../../../shared/i18n/locale';
import { AnchoredLayer, type AnchorRect } from '../../../shared/ui/AnchoredLayer';
import { AddStickerIcon, BlockStickerIcon, CopyIcon, DeleteIcon, MuteIcon, QuoteIcon, RecallIcon, RemoveForAllIcon, TranslateIcon } from './messageIcons';
import type { MessageActionId } from './timeline';

const PER_ROW = 5;

function copyWithFallback(text: string): boolean {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.left = '-9999px';
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

/** Copies text, falling back to execCommand where the async clipboard is missing or blocked. */
/** 复制文字；异步剪贴板不可用或被拦截时退回 execCommand。 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // The legacy path below covers browsers that block the async clipboard.
    // 下面的旧方法用于拦截异步剪贴板的浏览器。
  }
  return copyWithFallback(text);
}

const ICONS: Record<MessageActionId, ComponentType> = {
  copy: CopyIcon,
  addSticker: AddStickerIcon,
  quote: QuoteIcon,
  recall: RecallIcon,
  hide: DeleteIcon,
  translate: TranslateIcon,
  remove: RemoveForAllIcon,
  mute: MuteIcon,
  blockSticker: BlockStickerIcon,
};

interface Props {
  anchor: AnchorRect;
  actions: MessageActionId[];
  onAction: (id: MessageActionId) => void;
  onClose: () => void;
  scrollContainer: HTMLElement | null;
  guardRelease: boolean;
  insetTop: number;
  /** Moves focus to the first item, for keyboard and screen-reader opens. */
  /** 把焦点移到第一项，用于键盘和读屏方式打开。 */
  autoFocus: boolean;
}

/**
 * WeChat's dark long-press menu: white line icons over short labels, five per row, pointing at the bubble.
 * Choosing an item closes the menu first and then runs it.
 * 微信的深色长按菜单：白色线条图标加简短文字，每行五个，箭头指向气泡。选择某项时先关闭菜单再执行。
 */
export function MessagePopover({ anchor, actions, onAction, onClose, scrollContainer, guardRelease, insetTop, autoFocus }: Props) {
  const tr = useTr();
  const [focusIndex, setFocusIndex] = useState(0);
  const itemsRef = useRef<(HTMLButtonElement | null)[]>([]);

  const labels: Record<MessageActionId, string> = {
    copy: tr('复制', 'Copy'),
    addSticker: tr('添加到表情', 'Add to stickers'),
    quote: tr('引用', 'Quote'),
    recall: tr('撤回', 'Recall'),
    hide: tr('删除', 'Delete'),
    translate: tr('翻译', 'Translate'),
    remove: tr('删除（管理员）', 'Remove for all'),
    mute: tr('禁言', 'Mute'),
    blockSticker: tr('封禁表情', 'Block sticker'),
  };
  // The long labels are drawn on two lines, so their cells stay close to the others in width.
  // 较长的文字分两行显示，使其格子的宽度与其他格子相近。
  const lines: Partial<Record<MessageActionId, [string, string]>> = {
    addSticker: [tr('添加', 'Add to'), tr('到表情', 'stickers')],
    remove: [tr('删除', 'Remove'), tr('（管理员）', 'for all')],
  };

  useEffect(() => {
    if (!autoFocus) return;
    // The layer stays invisible until it has measured itself, and invisible items cannot take focus.
    // 浮层在完成测量之前不可见，而不可见的项无法获得焦点。
    const frame = requestAnimationFrame(() => itemsRef.current[0]?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [autoFocus]);

  function move(index: number) {
    const last = actions.length - 1;
    const next = index < 0 ? last : index > last ? 0 : index;
    setFocusIndex(next);
    itemsRef.current[next]?.focus({ preventScroll: true });
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const steps: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: PER_ROW, ArrowUp: -PER_ROW };
    const step = steps[event.key];
    if (step !== undefined) {
      event.preventDefault();
      const target = focusIndex + step;
      // Up and down stay on the same column instead of wrapping around.
      // 上下方向键停留在同一列，不会绕回。
      if (Math.abs(step) === PER_ROW && (target < 0 || target >= actions.length)) return;
      move(target);
    } else if (event.key === 'Home') {
      event.preventDefault();
      move(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      move(actions.length - 1);
    } else if (event.key === 'Tab') {
      event.preventDefault();
      onClose();
    }
  }

  function choose(id: MessageActionId) {
    onClose();
    onAction(id);
  }

  return (
    <AnchoredLayer anchor={anchor} prefer="above" tone="dark" onClose={onClose} scrollContainer={scrollContainer} guardRelease={guardRelease} insetTop={insetTop}>
      <div
        role="menu"
        aria-label={tr('消息操作', 'Message actions')}
        onKeyDown={onKeyDown}
        className="grid gap-y-1 px-2 py-2"
        style={{ gridTemplateColumns: `repeat(${Math.min(PER_ROW, actions.length)}, minmax(56px, auto))` }}
      >
        {actions.map((id, index) => {
          const Icon = ICONS[id];
          return (
            <button
              key={id}
              ref={(element) => {
                itemsRef.current[index] = element;
              }}
              type="button"
              role="menuitem"
              aria-label={lines[id] ? labels[id] : undefined}
              tabIndex={index === focusIndex ? 0 : -1}
              onClick={() => choose(id)}
              onFocus={() => setFocusIndex(index)}
              className="flex min-h-[60px] flex-col items-center justify-center gap-1 rounded-[4px] px-1.5 py-1.5 text-white outline-none active:bg-white/10 focus-visible:bg-white/15 focus-visible:ring-2 focus-visible:ring-white/80"
            >
              <Icon />
              <span className="flex flex-col items-center whitespace-nowrap text-xs leading-4" aria-hidden={lines[id] ? true : undefined}>
                {lines[id] ? lines[id].map((line) => <span key={line}>{line}</span>) : labels[id]}
              </span>
            </button>
          );
        })}
      </div>
    </AnchoredLayer>
  );
}
