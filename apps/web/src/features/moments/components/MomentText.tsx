import { memo, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { useTr } from '../../../shared/i18n/locale';
import type { AnchorRect } from '../../../shared/ui/AnchoredLayer';
import { toast } from '../../../shared/ui/toast';
import { useLongPress, type LongPressInfo } from '../../../shared/ui/useLongPress';
import { LinkifiedText } from '../../chat/room/LinkifiedText';
import { copyText } from '../../chat/room/MessagePopover';
import { TranslationCard } from '../../chat/room/TranslationCard';
import { MomentPopover, momentsHeaderBottom, type MomentMenuItem } from './PostMenus';

/** Lines shown before 全文. */
/** 出现「全文」之前显示的行数。 */
const CLAMP_LINES = 6;

/**
 * Whether each text was long at the width it was measured at, so a card that mounts again (returning to the
 * feed) draws 全文 on its first render and the restored scroll position stays exact.
 * 每段正文在测量时的宽度下是否超长。再次挂载的卡片（回到信息流时）在第一次渲染时就画出「全文」，恢复的滚动位置因此保持准确。
 */
const measured = new Map<string, { width: number; long: boolean }>();
const MEASURED_MAX = 400;

function remember(id: string, width: number, long: boolean): void {
  measured.delete(id);
  measured.set(id, { width, long });
  if (measured.size > MEASURED_MAX) {
    const oldest = measured.keys().next().value;
    if (oldest !== undefined) measured.delete(oldest);
  }
}

/** True when some of the selection lies inside the element, so the desktop keeps its own context menu. */
/** 选区有一部分在该元素内时为 true，桌面端因此保留系统自己的右键菜单。 */
function hasSelectionIn(element: HTMLElement): boolean {
  const selection = typeof window === 'undefined' ? null : window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false;
  const range = selection.getRangeAt(0);
  return element.contains(range.commonAncestorContainer) || range.intersectsNode(element);
}

function pointRect(x: number, y: number): AnchorRect {
  return { top: y, bottom: y, left: x, right: x };
}

export interface MomentTextProps {
  /** Stable per post (the view key), for the measurement cache. */
  /** 每条动态稳定的标识（视图 key），用于测量缓存。 */
  id: string;
  text: string;
  /** The detail page: the whole text, with no 全文 / 收起. */
  /** 详情页：显示全文，没有「全文 / 收起」。 */
  alwaysOpen?: boolean;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  /** Adds 投诉 to the long-press menu (someone else's post). */
  /** 在长按菜单中加入「投诉」（别人的动态）。 */
  onReport?: () => void;
}

interface MenuState {
  anchor: AnchorRect;
  held: boolean;
  focus: boolean;
}

/**
 * The body of a post: links, addresses and phone numbers tappable, clamped to six lines by measurement with
 * 全文 / 收起, and a long press (right-click, ContextMenu key, Shift+F10 or the hidden 更多操作 button) for 复制 /
 * 翻译 / 投诉. 收起 brings the post's top back under the header when it had scrolled above it.
 * 动态正文：网址、邮箱和电话可点按；按测量结果限制为六行，带「全文 / 收起」；长按（右键、ContextMenu 键、Shift+F10 或隐藏的
 * 「更多操作」按钮）打开「复制 / 翻译 / 投诉」。「收起」时若动态顶部已滚到顶栏上方，会把它放回顶栏下方。
 */
export const MomentText = memo(function MomentText({ id, text, alwaysOpen = false, expanded, onExpandedChange, onReport }: MomentTextProps) {
  const tr = useTr();
  const textRef = useRef<HTMLDivElement>(null);
  const [long, setLong] = useState(() => measured.get(id)?.long ?? false);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [translation, setTranslation] = useState(0);
  const [collapsedAt, setCollapsedAt] = useState(0);
  const open = alwaysOpen || expanded;

  useLayoutEffect(() => {
    const element = textRef.current;
    if (!element || alwaysOpen) return;
    const measure = () => {
      const width = Math.round(element.clientWidth);
      if (width <= 0) return;
      const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight) || 22;
      // Clamped, the box is shorter than its content; open, the content is taller than six lines.
      // 收起时，盒子比内容矮；展开时，内容高于六行。
      const next = open ? element.scrollHeight > lineHeight * CLAMP_LINES + 1 : element.scrollHeight > element.clientHeight + 1;
      remember(id, width, next);
      setLong((prev) => (prev === next ? prev : next));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [id, text, open, alwaysOpen]);

  // After 收起 the post can be left above the header; bring its top back to just below it.
  // 「收起」之后动态可能停在顶栏上方；把它的顶部放回顶栏正下方。
  useLayoutEffect(() => {
    if (collapsedAt === 0) return;
    const article = textRef.current?.closest('article');
    if (!article) return;
    const top = article.getBoundingClientRect().top;
    const headerBottom = momentsHeaderBottom();
    if (top < headerBottom) window.scrollBy({ top: top - headerBottom, behavior: 'auto' });
  }, [collapsedAt]);

  function openMenu(info: LongPressInfo, focus: boolean) {
    const element = textRef.current;
    const rect = element?.getBoundingClientRect() ?? info.rect;
    // A tall text points its menu at the press instead of the whole block.
    // 较高的正文让菜单指向按压位置，而不是整段文字。
    const tall = rect.height > window.innerHeight * 0.4;
    setMenu({ anchor: tall && info.source !== 'keyboard' ? pointRect(info.clientX, info.clientY) : rect, held: info.held, focus });
  }

  const press = useLongPress({ onLongPress: (info) => openMenu(info, info.source === 'keyboard') });
  const pressed = press.pressed || menu !== null;

  function onContextMenu(event: MouseEvent<HTMLDivElement>) {
    // A desktop selection keeps the browser's own menu, so Copy works on the selected words.
    // 桌面端有选区时保留浏览器自己的菜单，「复制」作用于所选文字。
    if (hasSelectionIn(event.currentTarget)) return;
    press.handlers.onContextMenu(event);
  }

  function openFromButton() {
    const rect = textRef.current?.getBoundingClientRect();
    if (!rect) return;
    openMenu({ rect, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, source: 'keyboard', held: false }, true);
  }

  function toggle() {
    if (open) {
      onExpandedChange(false);
      setCollapsedAt((value) => value + 1);
    } else {
      onExpandedChange(true);
    }
  }

  const items: MomentMenuItem[] = [
    {
      key: 'copy',
      label: tr('复制', 'Copy'),
      onSelect: () => {
        void copyText(text).then((ok) => toast(ok ? tr('已复制', 'Copied') : tr('复制失败', 'Couldn’t copy')));
      },
    },
    { key: 'translate', label: tr('翻译', 'Translate'), onSelect: () => setTranslation((value) => value + 1) },
  ];
  if (onReport) items.push({ key: 'report', label: tr('投诉', 'Report'), onSelect: onReport });

  return (
    <div className="relative mt-1">
      <div
        ref={textRef}
        className={`whitespace-pre-wrap break-words text-[15px] leading-[22px] text-wx-ink [overflow-wrap:anywhere] [-webkit-touch-callout:none] [@media(pointer:coarse)]:select-none ${pressed ? 'rounded-[2px] bg-wx-pressed' : ''}`}
        style={open ? undefined : { display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: CLAMP_LINES, overflow: 'hidden' }}
        {...press.handlers}
        onContextMenu={onContextMenu}
      >
        <LinkifiedText text={text} own={false} />
      </div>
      {long && !alwaysOpen ? (
        // The pseudo-element widens the target to 44px without moving the lines around it.
        // 伪元素把可点按区域扩大到 44px，而不移动周围的行。
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="relative -ml-1 mt-0.5 rounded-[4px] px-1 text-[15px] leading-[22px] text-wx-link after:absolute after:-inset-y-[11px] after:inset-x-0 after:content-[''] active:bg-wx-pressed"
        >
          {open ? tr('收起', 'Collapse') : tr('全文', 'Full text')}
        </button>
      ) : null}
      {/* Shown on focus without taking space, so nothing below moves. */}
      {/* 获得焦点时显示但不占位，下方内容不会移动。 */}
      <button
        type="button"
        onClick={openFromButton}
        className="sr-only focus:not-sr-only focus:absolute focus:left-0 focus:top-full focus:z-10 focus:mt-1 focus:whitespace-nowrap focus:rounded-[4px] focus:bg-white focus:px-2 focus:py-1 focus:text-xs focus:text-wx-ink focus:shadow"
      >
        {tr('更多操作', 'More actions')}
      </button>
      {translation > 0 ? (
        // The chat card is white on its own; on the white card it takes the comment-box grey instead.
        // 聊天的译文卡片本身是白色的；在白色的卡片上改用评论区的灰色。
        <div className="[&>div]:bg-wx-bar">
          <TranslationCard key={translation} text={text} own={false} onClose={() => setTranslation(0)} />
        </div>
      ) : null}
      {menu ? (
        <MomentPopover
          anchor={menu.anchor}
          items={items}
          label={tr('正文操作', 'Text actions')}
          onClose={() => setMenu(null)}
          guardRelease={menu.held}
          autoFocus={menu.focus}
        />
      ) : null}
    </div>
  );
});
