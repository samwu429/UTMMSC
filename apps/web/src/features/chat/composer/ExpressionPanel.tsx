import { useId, type KeyboardEvent, type ReactNode } from 'react';
import type { StickerItem } from '@utmmsc/shared';
import { useTr } from '../../../shared/i18n/locale';
import { useStickerLibrary, type StickerTab } from '../stickers/store';
import { EmojiIcon, GearIcon, HeartIcon } from './composerIcons';
import { EmojiPanel } from './EmojiPanel';
import { StickerPanel } from './StickerPanel';

interface Props {
  /** The panel's whole height, the safe area under its tab bar included. */
  /** 面板的总高度，包括标签栏下方的安全区。 */
  height: number;
  canSend: boolean;
  onInsert: (emoji: string) => void;
  onBackspace: () => void;
  onSend: () => void;
  onSendSticker: (sticker: StickerItem) => void;
  onAddStickers: () => void;
  onManageStickers: () => void;
}

const TABS: readonly StickerTab[] = ['emoji', 'stickers'];

/**
 * The expression panel that opens from the smiley button, at the keyboard's height: the emoji panel or 我的表情 above
 * a 44 px tab bar, which reopens on the tab used last on this device. While 我的表情 is selected a gear for 整理表情
 * sits at the bar's right end, outside the tablist; the emoji tab has none, so a slightly low tap on its floating
 * keys can never open the manage screen.
 * 点笑脸按钮打开的表情面板，与键盘等高：在 44px 的标签栏上方显示表情面板或「我的表情」，并在本设备上回到上次使用的标签。
 * 选中「我的表情」时，标签栏右端、标签列表之外有一个「整理表情」齿轮；表情标签下没有齿轮，因此在悬浮按键上稍微点低一点也不会打开管理界面。
 */
export function ExpressionPanel({ height, canSend, onInsert, onBackspace, onSend, onSendSticker, onAddStickers, onManageStickers }: Props) {
  const tr = useTr();
  const id = useId();
  const tab = useStickerLibrary((s) => s.tab);
  const setTab = useStickerLibrary((s) => s.setTab);
  const panelId = `${id}panel`;
  const tabId = (value: StickerTab) => `${id}tab-${value}`;
  const labels: Record<StickerTab, { label: string; icon: ReactNode }> = {
    emoji: { label: tr('表情', 'Emoji'), icon: <EmojiIcon className="h-6 w-6" /> },
    stickers: { label: tr('我的表情', 'My stickers'), icon: <HeartIcon /> },
  };

  function onTabKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const current = TABS.indexOf(tab);
    let next = current;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = TABS.length - 1;
    else next = (current + (event.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length;
    const value = TABS[next] ?? 'emoji';
    setTab(value);
    document.getElementById(tabId(value))?.focus();
  }

  return (
    <div className="box-border flex shrink-0 flex-col bg-wx-bar" style={{ height }}>
      <div role="tabpanel" id={panelId} aria-labelledby={tabId(tab)} className="min-h-0 flex-1">
        {tab === 'stickers' ? (
          <StickerPanel onSend={onSendSticker} onAdd={onAddStickers} />
        ) : (
          <EmojiPanel height="100%" insetBottom="0px" canSend={canSend} onInsert={onInsert} onBackspace={onBackspace} onSend={onSend} />
        )}
      </div>
      <div className="shrink-0 border-t-[0.5px] border-wx-line bg-wx-bar" style={{ paddingBottom: 'var(--safe-bottom)' }}>
        <div className="flex h-11 items-center pl-2 pr-1">
          <div role="tablist" className="flex items-center gap-1" onKeyDown={onTabKey}>
            {TABS.map((value) => {
              const on = value === tab;
              return (
                <button
                  key={value}
                  id={tabId(value)}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  aria-controls={panelId}
                  aria-label={labels[value].label}
                  tabIndex={on ? 0 : -1}
                  onClick={() => setTab(value)}
                  className={`flex h-9 w-12 items-center justify-center rounded-[6px] ${on ? 'bg-white text-wx-ink' : 'text-wx-meta active:bg-wx-pressed'}`}
                >
                  {labels[value].icon}
                </button>
              );
            })}
          </div>
          {tab === 'stickers' ? (
            <button
              type="button"
              onClick={onManageStickers}
              aria-label={tr('整理表情', 'Manage stickers')}
              className="ml-auto flex h-11 w-11 items-center justify-center rounded-md text-wx-ink active:opacity-60"
            >
              <GearIcon />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
