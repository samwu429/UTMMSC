import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { create } from 'zustand';
import { useTr } from '../../../shared/i18n/locale';
import { useBackToClose } from '../../../shared/ui/overlayHistory';
import { commentBarKeepProps } from '../comment/useCommentBar';
import { CommentIcon, DotsIcon, HeartIcon } from '../icons';
import { useCloseOnUserScroll } from './PostMenus';

/** The pill slides open and shut in this long. */
/** 浮条展开和收起所用的时间。 */
const SLIDE_MS = 200;
/** The heart pops for this long after 赞, then the pill closes. */
/** 点「赞」后心形弹跳这么久，然后浮条收起。 */
const POP_MS = 150;

/** Which card's pill is open; opening one closes any other. */
/** 哪张卡片的浮条处于打开状态；打开一个会关闭其他的。 */
const useOpenPill = create<{ key: string | null }>()(() => ({ key: null }));

/** Closes whichever pill is open, for example when a viewer or the comment bar takes over. */
/** 关闭当前打开的浮条，例如查看器或评论栏接管时。 */
export function closeActionPill(): void {
  useOpenPill.setState({ key: null });
}

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

const CLIP_OPEN = 'inset(0 0 0 0 round 4px)';
const CLIP_SHUT = 'inset(0 0 0 100% round 4px)';

export interface ActionPillProps {
  /** Unique on the page: the card's view key. */
  /** 在页面中唯一：卡片的视图 key。 */
  pillKey: string;
  liked: boolean;
  /** 赞 / 取消: the card flips the desired state. */
  /** 「赞 / 取消」：卡片翻转想要的状态。 */
  onLike: () => void;
  /** 评论: must open the comment bar synchronously, inside this tap. */
  /** 「评论」：必须在这次点击中同步打开评论栏。 */
  onComment: () => void;
}

/**
 * The "··" button and WeChat's dark pill that slides left out of it: [heart 赞 | 取消] [评论]. One pill is open at a
 * time; it closes on an outside press, the member's own scroll, Escape, back, or another "··". Escape returns
 * focus to "··". Reduced motion drops the slide and the heart pop.
 * 「··」按钮，以及从它向左滑出的微信深色浮条：[heart 赞 | 取消] [评论]。同一时间只有一个浮条打开；点击外部、成员自己滚动、Escape、返回
 * 或点击另一个「··」时关闭。按 Escape 后焦点回到「··」。减少动态效果时没有滑动和心形弹跳。
 */
export function ActionPill({ pillKey, liked, onLike, onComment }: ActionPillProps) {
  const tr = useTr();
  const menuId = useId();
  const open = useOpenPill((s) => s.key === pillKey);
  const [rendered, setRendered] = useState(open);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  const heartRef = useRef<HTMLSpanElement>(null);
  const itemsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const popTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const close = useCallback(
    (returnFocus = false) => {
      if (useOpenPill.getState().key === pillKey) useOpenPill.setState({ key: null });
      if (returnFocus) triggerRef.current?.focus({ preventScroll: true });
    },
    [pillKey],
  );

  useBackToClose(() => close(), open);
  useCloseOnUserScroll(open, () => close());

  // Mount on open; on close play the slide back, then unmount.
  // 打开时挂载；关闭时先播放收回动画，再卸载。
  useLayoutEffect(() => {
    if (open) {
      setRendered(true);
      return;
    }
    const pill = pillRef.current;
    if (!pill) return;
    // Focus left inside a pill that is going away would be lost; give it back to "··".
    // 焦点留在即将消失的浮条里会丢失；把它还给「··」。
    if (pill.contains(document.activeElement)) triggerRef.current?.focus({ preventScroll: true });
    if (reducedMotion() || typeof pill.animate !== 'function') {
      setRendered(false);
      return;
    }
    const animation = pill.animate([{ clipPath: CLIP_OPEN }, { clipPath: CLIP_SHUT }], { duration: SLIDE_MS, easing: 'ease-in', fill: 'forwards' });
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      setRendered(false);
    };
    animation.onfinish = finish;
    const timer = setTimeout(finish, SLIDE_MS + 50);
    return () => {
      clearTimeout(timer);
      animation.onfinish = null;
      // Opened again while closing: drop the held shut frame.
      // 收起途中再次打开：去掉停留的收起帧。
      if (!done) animation.cancel();
    };
  }, [open]);

  useLayoutEffect(() => {
    const pill = pillRef.current;
    if (!open || !rendered || !pill) return;
    if (!reducedMotion() && typeof pill.animate === 'function') {
      pill.animate([{ clipPath: CLIP_SHUT }, { clipPath: CLIP_OPEN }], { duration: SLIDE_MS, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
    }
    itemsRef.current[0]?.focus({ preventScroll: true });
  }, [open, rendered]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (pillRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close(true);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, close]);

  // A pill left open by a card that unmounts would block every other "··".
  // 卡片卸载时若浮条仍处于打开状态，会挡住其他所有「··」。
  useEffect(
    () => () => {
      if (useOpenPill.getState().key === pillKey) useOpenPill.setState({ key: null });
    },
    [pillKey],
  );

  useEffect(
    () => () => {
      if (popTimer.current) clearTimeout(popTimer.current);
    },
    [],
  );

  function like() {
    // A second tap during the pop would undo the first before the member saw it.
    // 弹跳期间的第二次点击会在成员看到之前撤销第一次。
    if (popTimer.current) return;
    onLike();
    const heart = heartRef.current;
    if (reducedMotion() || !heart || typeof heart.animate !== 'function') {
      close(true);
      return;
    }
    heart.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.4)' }, { transform: 'scale(1)' }], { duration: POP_MS, easing: 'ease-out' });
    popTimer.current = setTimeout(() => {
      popTimer.current = null;
      close(true);
    }, POP_MS);
  }

  function comment() {
    // The bar takes focus in this same tap, so the pill closes without taking focus back.
    // 评论栏在同一次点击中获得焦点，因此浮条关闭时不收回焦点。
    onComment();
    close();
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const items = itemsRef.current.filter((item): item is HTMLButtonElement => item !== null);
    const index = items.findIndex((item) => item === document.activeElement);
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
      items[(index + step + items.length) % items.length]?.focus({ preventScroll: true });
    } else if (event.key === 'Home') {
      event.preventDefault();
      items[0]?.focus({ preventScroll: true });
    } else if (event.key === 'End') {
      event.preventDefault();
      items[items.length - 1]?.focus({ preventScroll: true });
    } else if (event.key === 'Tab') {
      event.preventDefault();
      close(true);
    }
  }

  return (
    // The 44px button spills over the 20px footer line and the content edge, so the dots sit flush with the text.
    // 44px 的按钮超出 20px 高的底栏行和内容边缘，使两个点与文字对齐。
    <div className="relative -my-3 -mr-1.5 flex shrink-0 items-center">
      {rendered ? (
        <div
          ref={pillRef}
          id={menuId}
          role="menu"
          aria-label={tr('赞或评论', 'Like or comment')}
          onKeyDown={onMenuKeyDown}
          className={`absolute right-full top-1/2 z-10 mr-0.5 flex h-10 -translate-y-1/2 items-stretch overflow-hidden rounded-[4px] bg-wx-popover text-white ${open ? '' : 'pointer-events-none'}`}
        >
          <button
            ref={(element) => {
              itemsRef.current[0] = element;
            }}
            type="button"
            role="menuitemcheckbox"
            aria-checked={liked}
            onClick={like}
            className="flex min-w-[96px] items-center justify-center gap-1.5 whitespace-nowrap px-4 text-[14px] outline-none active:bg-white/10 focus-visible:bg-white/15"
          >
            <span ref={heartRef} className="flex">
              <HeartIcon className="h-[18px] w-[18px]" />
            </span>
            {liked ? tr('取消', 'Unlike') : tr('赞', 'Like')}
          </button>
          <span className="my-2.5 w-px bg-black/30" aria-hidden />
          <button
            ref={(element) => {
              itemsRef.current[1] = element;
            }}
            type="button"
            role="menuitem"
            onClick={comment}
            {...commentBarKeepProps}
            className="flex min-w-[96px] items-center justify-center gap-1.5 whitespace-nowrap px-4 text-[14px] outline-none active:bg-white/10 focus-visible:bg-white/15"
          >
            <CommentIcon className="h-[18px] w-[18px]" />
            {tr('评论', 'Comment')}
          </button>
        </div>
      ) : null}
      <button
        ref={triggerRef}
        type="button"
        aria-label={tr('赞或评论', 'Like or comment')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={rendered ? menuId : undefined}
        onClick={() => useOpenPill.setState({ key: open ? null : pillKey })}
        className="flex h-11 w-11 items-center justify-center"
      >
        <span className="flex h-5 w-8 items-center justify-center rounded-[4px] bg-wx-bar text-wx-link" aria-hidden>
          <DotsIcon />
        </span>
      </button>
    </div>
  );
}
