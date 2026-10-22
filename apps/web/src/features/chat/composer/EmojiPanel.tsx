import { useState } from 'react';
import { useTr } from '../../../shared/i18n/locale';
import { useDraftsStore } from '../state/drafts';
import { BackspaceIcon } from './composerIcons';
import { EMOJIS } from './emojiCodes';

const PER_ROW = 8;

function EmojiGrid({ items, onInsert }: { items: readonly string[]; onInsert: (emoji: string) => void }) {
  return (
    <div className="grid grid-cols-8">
      {items.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={() => onInsert(emoji)}
          className="flex h-11 items-center justify-center rounded-md text-[26px] leading-none active:bg-wx-pressed"
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

interface Props {
  height: number;
  canSend: boolean;
  onInsert: (emoji: string) => void;
  onBackspace: () => void;
  onSend: () => void;
}

/**
 * Unicode emoji panel at the keyboard's height, with a recent row and floating delete and send keys
 * as in WeChat. The recent row is read once when the panel opens, so it does not reorder under the finger.
 * 与键盘等高的 Unicode 表情面板，带最近使用一行以及悬浮的删除键和发送键，与微信一致。
 * 最近使用一行只在面板打开时读取一次，点选时不会在手指下重新排序。
 */
export function EmojiPanel({ height, canSend, onInsert, onBackspace, onSend }: Props) {
  const tr = useTr();
  const [recent] = useState(() => useDraftsStore.getState().recentEmoji.slice(0, PER_ROW));
  return (
    <div
      role="group"
      aria-label={tr('表情', 'Emoji')}
      className="relative box-border shrink-0 border-t-[0.5px] border-wx-line bg-wx-bar"
      style={{ height, paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="h-full touch-pan-y overflow-y-auto overscroll-contain px-3 pb-16 pt-3">
        {recent.length ? (
          <>
            <p className="px-1 pb-1 text-[12px] text-wx-meta">{tr('最近使用', 'Recent')}</p>
            <EmojiGrid items={recent} onInsert={onInsert} />
          </>
        ) : null}
        <p className={`px-1 pb-1 text-[12px] text-wx-meta ${recent.length ? 'pt-3' : ''}`}>{tr('所有表情', 'All emoji')}</p>
        <EmojiGrid items={EMOJIS} onInsert={onInsert} />
      </div>
      <div
        className="pointer-events-none absolute right-0 flex items-center gap-2 bg-gradient-to-l from-wx-bar from-60% to-transparent py-2 pl-8 pr-3"
        style={{ bottom: 'env(safe-area-inset-bottom)' }}
      >
        <button
          type="button"
          onClick={onBackspace}
          className="pointer-events-auto flex h-10 w-14 items-center justify-center rounded-[4px] bg-white text-wx-ink shadow-sm active:bg-wx-pressed"
          aria-label={tr('删除', 'Delete')}
        >
          <BackspaceIcon />
        </button>
        <button
          type="button"
          onClick={onSend}
          disabled={!canSend}
          className="pointer-events-auto h-10 min-w-14 rounded-[4px] bg-brand-800 px-3 text-[15px] font-medium text-white shadow-sm active:bg-brand-900 disabled:bg-white disabled:text-wx-meta"
        >
          {tr('发送', 'Send')}
        </button>
      </div>
    </div>
  );
}
