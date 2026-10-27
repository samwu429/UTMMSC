import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import type { StickerRef } from '@utmmsc/shared';
import { useTr } from '../../../shared/i18n/locale';
import { useReducedMotion } from '../../../shared/media/reducedMotion';
import { useSessionStore } from '../../../shared/session/store';
import { ActionSheet } from '../../../shared/ui/ActionSheet';
import { useBackToClose } from '../../../shared/ui/overlayHistory';
import { toast } from '../../../shared/ui/toast';
import { useLongPress } from '../../../shared/ui/useLongPress';
import { stickerOutcomeText } from '../stickers/fromMessage';
import { stickerFileSrc, stickerThumbSrc } from '../stickers/media';
import { useStickerLibrary } from '../stickers/store';
import { StickerPlayMark } from './messageIcons';
import { saveImageFromUrl } from './saveImage';
import { fitStickerPreview } from './stickerBox';
import { useStickerSource } from './StickerMessage';
import { contextMenuOpensSave } from './stickerPreview';

/** Marks the controls (data-viewer-action) a tap does not close the preview on. */
/** 标记点按时不会关闭预览的控件（data-viewer-action）。 */
const ACTION_SELECTOR = '[data-viewer-action]';

const BUTTON = 'inline-flex h-10 min-w-[88px] items-center justify-center gap-2 rounded-[8px] px-5 text-[15px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-white/80';

interface Props {
  sticker: StickerRef;
  /** The member can post in this chat now, so 发送 is offered. */
  /** 成员现在可以在这个聊天中发言，因此提供「发送」。 */
  canSend: boolean;
  onSend(): void;
  onClose(): void;
}

/**
 * The tap preview of a sticker message (1.6): a dim full-screen backdrop with the sticker large in the upper middle,
 * playing, and one row of actions in the lower third: 添加到表情 (or the gray 已添加), 发送 into this chat, and 播放 /
 * 暂停 when reduced motion shows it as a still. A tap anywhere but the actions closes it, the sticker included; so do
 * the system back gesture and Escape. A long press on the sticker offers 保存图片, which saves the original file; so do
 * a right-click and, from the keyboard, the ContextMenu key or Shift+F10 on any control.
 * 表情消息的点按预览（1.6）：全屏暗色背景，表情在上方居中放大并播放；下方三分之一处一行操作：「添加到表情」（或灰色的「已添加」）、
 * 「发送」到这个聊天，以及减弱动态效果时显示静态图所用的「播放 / 暂停」。点按操作以外的任何地方都会关闭预览，包括表情本身；
 * 系统返回手势和 Escape 也会关闭。长按表情可「保存图片」，保存的是原始文件；右键以及键盘上在任何控件上按 ContextMenu 键或 Shift+F10 也可以。
 */
export function StickerViewer({ sticker, canSend, onSend, onClose }: Props) {
  const tr = useTr();
  const token = useSessionStore((s) => s.mediaToken);
  const reducedMotion = useReducedMotion();
  const added = useStickerLibrary((s) => s.has(sticker.id));
  const rootRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);
  const [adding, setAdding] = useState(false);
  // Only reduced motion holds an animated sticker still; 播放 then lets it move.
  // 只有减弱动态效果时，动态表情才以静态图显示；这时「播放」让它动起来。
  const [playRequested, setPlayRequested] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);

  const toggles = sticker.animated && reducedMotion;
  const still = toggles && !playRequested;
  const fileSrc = stickerFileSrc(sticker, token);
  const load = useStickerSource(still ? `still:${sticker.id}:${sticker.thumb ?? ''}` : `file:${sticker.id}`, still ? stickerThumbSrc(sticker, token) : fileSrc, fileSrc, still);
  const size = fitStickerPreview(sticker.width, sticker.height, viewportWidth);
  const gone = load.phase === 'gone';
  const failed = load.phase === 'failed';
  const src = load.phase === 'stillBroken' ? null : load.src;

  useBackToClose(onClose);

  const press = useLongPress({ onLongPress: () => setSheet(true) });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // The collection decides between 添加到表情 and 已添加, so make sure it is current.
  // 由表情列表决定显示「添加到表情」还是「已添加」，因此先确保它是最新的。
  useEffect(() => {
    void useStickerLibrary.getState().ensureFresh();
  }, []);

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Focus goes to the first action on open and back to where it was (the row) on close.
  // 打开时焦点移到第一个操作上，关闭时回到原来的位置（消息行）。
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = actionsRef.current?.querySelector<HTMLButtonElement>('button') ?? rootRef.current;
    first?.focus({ preventScroll: true });
    return () => {
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  // 添加到表情 turns into plain text once added, so focus that was on it stays inside the preview.
  // 添加成功后「添加到表情」变成纯文字，原本在它上面的焦点因此留在预览之内。
  useEffect(() => {
    const root = rootRef.current;
    if (!added || !root || root.contains(document.activeElement)) return;
    (actionsRef.current?.querySelector<HTMLButtonElement>('button') ?? root).focus({ preventScroll: true });
  }, [added]);

  async function add() {
    if (adding) return;
    setAdding(true);
    const outcome = await useStickerLibrary.getState().addSticker(sticker);
    toast(stickerOutcomeText(outcome, tr));
    if (mountedRef.current) setAdding(false);
  }

  async function save() {
    if (!fileSrc) {
      toast(tr('保存失败', 'Couldn’t save the image'));
      return;
    }
    await saveImageFromUrl(fileSrc, `utmmsc-${sticker.id}`, tr);
  }

  function onClick(event: MouseEvent<HTMLDivElement>) {
    const target = event.target;
    // Taps in the save sheet bubble here through React but are not inside the preview.
    // 保存操作表中的点按会经 React 冒泡到这里，但不在预览之内。
    if (sheet || !(target instanceof Element) || !rootRef.current?.contains(target)) return;
    if (target.closest(ACTION_SELECTOR)) return;
    onClose();
  }

  // The ContextMenu key and Shift+F10 on any control open 保存图片, as in the photo viewer; focus goes back to that
  // control when the sheet closes. A finger or pen opens it only by the long press on the sticker.
  // 在任何控件上按 ContextMenu 键或 Shift+F10 都会打开「保存图片」，与图片查看器相同；操作表关闭后焦点回到该控件。手指或触控笔只能通过长按表情打开。
  function onContextMenu(event: MouseEvent<HTMLDivElement>) {
    const target = event.target;
    const inside = target instanceof Node && rootRef.current?.contains(target) === true;
    const pointerType = (event.nativeEvent as Partial<PointerEvent>).pointerType;
    if (!contextMenuOpensSave({ sheetOpen: sheet, inside, pointerType })) return;
    event.preventDefault();
    setSheet(true);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (sheet) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'Tab') {
      // Tab stays among the preview's own controls.
      // Tab 只在预览自己的控件之间切换。
      event.preventDefault();
      const stops = Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? []);
      if (stops.length === 0) return;
      const at = stops.findIndex((stop) => stop === document.activeElement);
      const next = event.shiftKey ? (at <= 0 ? stops.length - 1 : at - 1) : (at + 1) % stops.length;
      stops[next]?.focus();
    }
  }

  const title = sticker.animated ? tr('动画表情', 'Animated sticker') : tr('表情', 'Sticker');
  const failureText = gone ? tr('这个表情已失效', 'This sticker is no longer available.') : tr('加载失败，点按重试', "Couldn't load. Tap to retry.");
  const failureProps = failed ? { 'data-viewer-action': '', onClick: load.retry } : {};

  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      tabIndex={-1}
      className="wx-fade fixed inset-0 z-[55] flex select-none flex-col bg-black/70 outline-none"
      style={{
        touchAction: 'none',
        overscrollBehavior: 'contain',
        paddingTop: 'var(--safe-top)',
        paddingBottom: 'var(--safe-bottom)',
        paddingLeft: 'var(--safe-left)',
        paddingRight: 'var(--safe-right)',
      }}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onKeyDown={onKeyDown}
    >
      <div className="flex min-h-0 flex-[2] items-center justify-center px-8 pt-8">
        <div className="relative flex items-center justify-center" style={{ width: size.width, height: size.height, WebkitTouchCallout: 'none' }} {...press.handlers} {...failureProps}>
          {gone || failed ? (
            <span className="flex h-full w-full items-center justify-center rounded-[8px] bg-white/15 px-3 text-center text-[15px] leading-snug text-white">{failureText}</span>
          ) : (
            <>
              {!src || (load.fresh && load.phase !== 'shown') ? <span className="absolute inset-0 rounded-[8px] bg-white/10" aria-hidden /> : null}
              {src ? (
                <img
                  src={src}
                  alt=""
                  draggable={false}
                  decoding="async"
                  onLoad={load.onLoad}
                  onError={load.onError}
                  className="pointer-events-none absolute inset-0 h-full w-full object-contain"
                />
              ) : null}
              {still ? (
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
                  <StickerPlayMark className="h-10 w-10" />
                </span>
              ) : null}
            </>
          )}
        </div>
      </div>
      <div ref={actionsRef} className="flex flex-1 flex-wrap content-center items-center justify-center gap-3 px-6 pb-6">
        {added ? (
          <span className="px-2 text-[15px] leading-10 text-white/75">{tr('已添加', 'Added')}</span>
        ) : (
          <button type="button" data-viewer-action="" aria-busy={adding || undefined} onClick={() => void add()} className={`${BUTTON} bg-brand-800 text-white active:bg-brand-900`}>
            {adding ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden /> : null}
            {tr('添加到表情', 'Add to stickers')}
          </button>
        )}
        {canSend ? (
          <button type="button" data-viewer-action="" onClick={onSend} className={`${BUTTON} bg-white text-wx-ink active:bg-wx-pressed`}>
            {tr('发送', 'Send')}
          </button>
        ) : null}
        {toggles ? (
          <button type="button" data-viewer-action="" onClick={() => setPlayRequested((value) => !value)} className={`${BUTTON} bg-white/15 text-white active:bg-white/25`}>
            {playRequested ? tr('暂停', 'Pause') : tr('播放', 'Play')}
          </button>
        ) : null}
      </div>
      <button
        type="button"
        data-viewer-action=""
        onClick={onClose}
        className="sr-only rounded-full bg-black/60 px-4 py-2 text-sm text-white focus:not-sr-only focus:absolute focus:right-3 focus:top-3"
        style={{ marginTop: 'var(--safe-top)', marginRight: 'var(--safe-right)' }}
      >
        {tr('关闭', 'Close')}
      </button>
      {sheet ? <ActionSheet onClose={() => setSheet(false)} options={[{ label: tr('保存图片', 'Save image'), onSelect: () => void save() }]} /> : null}
    </div>,
    document.body,
  );
}
