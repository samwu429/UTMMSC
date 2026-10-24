import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import { MOMENT_COMMENT_MAX, momentTextLength, normalizeMomentComment, type MomentPerson } from '@utmmsc/shared';
import { useTr } from '../../../shared/i18n/locale';
import { useBackToClose } from '../../../shared/ui/overlayHistory';
import { toast } from '../../../shared/ui/toast';
import { CloseCircleIcon, EmojiIcon, KeyboardIcon } from '../../chat/composer/composerIcons';
import { EmojiPanel } from '../../chat/composer/EmojiPanel';
import { besideKeyboard, expectsSoftKeyboard, lastKeyboardHeight, measureKeyboardHeight, rememberKeyboardHeight, watchKeyboard } from '../../chat/composer/keyboardHeight';
import { deleteBackward, type TextSelection } from '../../chat/composer/mentionTokens';
import { useAutoGrow } from '../../chat/composer/useAutoGrow';
import { OVERLAY_BOTTOM_INSET } from '../../chat/room/useVisualViewport';
import { useDraftsStore } from '../../chat/state/drafts';
import { alignDelta, startSettle, stepSettle, visibleBand, type ViewportFacts } from '../layout/align';
import { useFeedStore } from '../state/feedStore';
import {
  COMMENT_BAR_KEEP_ATTRIBUTE,
  readCommentDraft,
  registerCommentBarHost,
  targetDraftKey,
  useCommentBarState,
  writeCommentDraft,
  type CommentTarget,
} from './useCommentBar';

type Panel = 'none' | 'emoji';
type Translate = (zh: string, en: string) => string;

/** A finger or wheel that moves this far outside the bar is the member scrolling, which closes it. */
/** 在评论栏外手指或滚轮移动超过这个距离即视为成员在滚动页面，评论栏随之关闭。 */
const DRAG_CLOSE_PX = 10;
/** The space a closed emoji panel holds for the keyboard is given up after this long if no keyboard appears. */
/** 若一直没有键盘出现，已关闭的表情面板为键盘保留的空间在这段时间后释放。 */
const HANDOFF_MAX_MS = 1000;
/**
 * How long the page's bottom spacer outlives a close: past the click of the press that closed the bar and the
 * keyboard's own slide down, so the content under that press does not jump before its click lands.
 * 关闭后页面底部留白继续保留的时间：要晚于关闭评论栏的那次按下所产生的点击，以及键盘自身的收起动画，
 * 这样那次按下位置的内容不会在点击到达之前跳动。
 */
const INSET_HOLD_MS = 400;
const SLIDE_MS = 200;
const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
const OPEN_TRANSFORM = 'translateY(0)';
const CLOSED_TRANSFORM = 'translateY(110%)';
/** Comments are one line, so a pasted line break becomes a space; one character for one keeps every caret position. */
/** 评论只有一行，粘贴进来的换行变成空格；一个字符换一个字符，光标位置都保持不变。 */
const LINE_BREAK = /[\r\n\u2028\u2029]/g;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

function isTextField(element: Element | null): boolean {
  return element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement || (element instanceof HTMLElement && element.isContentEditable);
}

/** The visual viewport the host is pinned to; while pinch-zoomed the host keeps the full layout height, and so does this. */
/** 评论栏外层所贴合的可视视口；双指缩放时外层保持完整的布局高度，这里也一样。 */
function readViewport(): ViewportFacts {
  const viewport = window.visualViewport;
  if (!viewport || Math.abs(viewport.scale - 1) > 0.01) return { offsetTop: 0, height: window.innerHeight };
  return { offsetTop: Math.max(0, viewport.offsetTop), height: viewport.height };
}

function personName(person: MomentPerson, tr: Translate): string {
  return person.displayName.trim() || tr('成员', 'Member');
}

function placeholderFor(target: CommentTarget, tr: Translate): string {
  if (target.replyTo) {
    const name = personName(target.replyTo.person, tr);
    return target.clubWide ? tr(`回复 ${name}（全社团可见）`, `Reply to ${name} (whole club can see)`) : tr(`回复 ${name}`, `Reply to ${name}`);
  }
  return target.clubWide ? tr('评论（全社团可见）', 'Comment (whole club can see)') : tr('评论', 'Comment');
}

function capComment(text: string): string {
  return Array.from(text).slice(0, MOMENT_COMMENT_MAX).join('');
}

function keepFocus(event: SyntheticEvent) {
  // The textarea keeps focus, so the keyboard stays up and its height can still be measured.
  // 文本框保持焦点，键盘不会收起，仍可测量其高度。
  event.preventDefault();
}

function BarButton({ label, tabbable, onClick, children }: { label: string; tabbable: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      tabIndex={tabbable ? 0 : -1}
      onPointerDown={keepFocus}
      onMouseDown={keepFocus}
      onClick={onClick}
      aria-label={label}
      className="-mb-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-wx-ink active:opacity-60"
    >
      {children}
    </button>
  );
}

interface Actions {
  open(target: CommentTarget): void;
  close(restoreFocus: boolean): void;
  scheduleAlign(expectMove: boolean): void;
  updateInset(): void;
}

export interface CommentBarProps {
  /** Px under the safe area covered by the page's fixed header. */
  /** 页面固定顶栏在安全区下方遮住的高度（像素）。 */
  headerHeight: number;
  /** The top safe area in px, measured by the host. */
  /** 顶部安全区的像素高度，由外层测量。 */
  safeTop: () => number;
}

/**
 * The WeChat comment bar: [text][emoji][发送], one line that wraps up to four, Enter sends. It opens from a tap
 * with the keyboard already rising, keeps the target 8px above itself once the keyboard has settled, swaps the
 * keyboard for the emoji panel at the same height, and closes on a scroll, an outside tap, Escape, back or a
 * keyboard dismiss, keeping the draft. Rendered by CommentBarHost at the bottom of its pinned layer.
 * 微信式评论栏：[文字][表情][发送]，单行文字最多折成四行，回车发送。它在点击中打开、键盘随之弹出；键盘稳定后让目标位于评论栏上方
 * 8px；表情面板以相同高度取代键盘；滚动页面、点击外部、Escape、返回或收起键盘时关闭，草稿保留。由 CommentBarHost 渲染在其固定层的底部。
 */
export function CommentBar({ headerHeight, safeTop }: CommentBarProps) {
  const tr = useTr();
  const barRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [target, setTarget] = useState<CommentTarget | null>(null);
  const [text, setText] = useState('');
  const [panel, setPanel] = useState<Panel>('none');
  const [panelHeight, setPanelHeight] = useState(lastKeyboardHeight);
  // The emoji panel gave way to the keyboard, which is not up yet; its space is held so the bar does not drop.
  // 表情面板已让位给键盘，但键盘尚未弹出；保留其空间，评论栏因此不会下落。
  const [handoff, setHandoff] = useState(false);
  const [reduced] = useState(prefersReducedMotion);

  // The truth for event handlers between renders; state follows it for the render.
  // 两次渲染之间供事件处理使用的真实状态；state 随之更新用于渲染。
  const targetRef = useRef<CommentTarget | null>(null);
  const textRef = useRef('');
  const panelRef = useRef<Panel>('none');
  const panelHeightRef = useRef(panelHeight);
  // Set right before the textarea is blurred for the emoji panel, so that blur does not close the bar.
  // 为打开表情面板而让输入框失焦之前设置，这次失焦因此不会关闭评论栏。
  const switchingRef = useRef(false);
  const composingRef = useRef(false);
  const openerRef = useRef<HTMLElement | null>(null);
  // The caret while the textarea is blurred (the emoji panel is open); the element is the truth while focused.
  // 输入框失焦时（表情面板打开）记录的光标位置；聚焦时以元素本身为准。
  const selectionRef = useRef<TextSelection>({ start: 0, end: 0 });
  const pendingCaretRef = useRef<number | null>(null);
  const alignFrameRef = useRef(0);
  // Clears the spacer a while after a close; see INSET_HOLD_MS.
  // 关闭一段时间后清除底部留白；见 INSET_HOLD_MS。
  const insetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const actionsRef = useRef<Actions | null>(null);

  const open = target !== null;
  const sendable = normalizeMomentComment(text).length > 0;

  useLayoutEffect(() => {
    panelHeightRef.current = panelHeight;
  });

  useAutoGrow(textareaRef, text, { maxLines: 4, active: open });

  // A caret moved by a replaced line break, the length cap or an emoji is put back once the value is rendered.
  // 因替换换行、长度上限或插入表情而移动的光标，在新值渲染后放回正确位置。
  useLayoutEffect(() => {
    const caret = pendingCaretRef.current;
    const element = textareaRef.current;
    if (caret === null || !element) return;
    pendingCaretRef.current = null;
    if (document.activeElement === element) element.setSelectionRange(caret, caret);
  }, [text]);

  function cancelAlign() {
    if (alignFrameRef.current) cancelAnimationFrame(alignFrameRef.current);
    alignFrameRef.current = 0;
  }

  function cancelInsetHold() {
    if (insetTimerRef.current !== null) clearTimeout(insetTimerRef.current);
    insetTimerRef.current = null;
  }

  function updateInset() {
    const bar = barRef.current;
    const inset = targetRef.current && bar ? Math.round(bar.offsetHeight + (measureKeyboardHeight() ?? 0)) : 0;
    if (useCommentBarState.getState().inset !== inset) useCommentBarState.setState({ inset });
  }

  function alignNow() {
    const current = targetRef.current;
    const bar = barRef.current;
    const anchor = current?.anchor() ?? null;
    if (!current || !bar || !anchor?.isConnected) return;
    const band = visibleBand(readViewport(), safeTop() + headerHeight, bar.offsetHeight);
    const delta = alignDelta(anchor.getBoundingClientRect(), band);
    if (Math.abs(delta) < 1) return;
    window.scrollBy({ top: delta, behavior: reduced ? 'auto' : 'smooth' });
  }

  /**
   * Scrolls the target into the band above the bar once the visual viewport has held still for two frames
   * (at most 450 ms). A wait already running picks up the latest target and sizes when it ends.
   * 可视视口连续两帧不变（最多等待 450 毫秒）后，把目标滚动到评论栏上方的可见区域。已在进行的等待结束时会使用最新的目标和尺寸。
   */
  function scheduleAlign(expectMove: boolean) {
    if (alignFrameRef.current) return;
    let state = startSettle(readViewport(), performance.now(), expectMove);
    const tick = () => {
      const step = stepSettle(state, readViewport(), performance.now());
      state = step.state;
      if (!step.settled) {
        alignFrameRef.current = requestAnimationFrame(tick);
        return;
      }
      actionsRef.current?.updateInset();
      // One more frame, so the page has rendered the bottom spacer for the new inset before it scrolls.
      // 再等一帧，让页面先按新的高度渲染底部留白，然后再滚动。
      alignFrameRef.current = requestAnimationFrame(() => {
        alignFrameRef.current = 0;
        alignNow();
      });
    };
    alignFrameRef.current = requestAnimationFrame(tick);
  }

  function applyText(next: string, caret: number | null) {
    textRef.current = next;
    if (caret !== null) {
      selectionRef.current = { start: caret, end: caret };
      pendingCaretRef.current = caret;
    }
    setText(next);
    const current = targetRef.current;
    if (current) writeCommentDraft(targetDraftKey(current), next);
  }

  function openFor(next: CommentTarget) {
    const bar = barRef.current;
    const textarea = textareaRef.current;
    if (!bar || !textarea) return;
    if (!targetRef.current) {
      const active = document.activeElement;
      openerRef.current = active instanceof HTMLElement && active !== document.body && !bar.contains(active) ? active : null;
    }
    cancelInsetHold();
    const fromPanel = panelRef.current !== 'none';
    const draft = readCommentDraft(targetDraftKey(next));
    const placeholder = placeholderFor(next, tr);
    // Written straight to the DOM before focusing, so the textarea is on screen, labelled and holding the draft
    // while the keyboard comes up inside this tap; the render that follows writes the same values.
    // 在聚焦之前直接写入 DOM，使输入框在这次点击中键盘弹出时已经在屏幕上、带有标签并装着草稿；随后的渲染写入的是相同的值。
    bar.removeAttribute('aria-hidden');
    bar.style.transform = OPEN_TRANSFORM;
    bar.style.opacity = '1';
    bar.style.pointerEvents = 'auto';
    textarea.tabIndex = 0;
    textarea.placeholder = placeholder;
    textarea.setAttribute('aria-label', placeholder);
    textarea.value = draft;
    targetRef.current = next;
    textRef.current = draft;
    panelRef.current = 'none';
    switchingRef.current = false;
    selectionRef.current = { start: draft.length, end: draft.length };
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(draft.length, draft.length);

    setTarget(next);
    setText(draft);
    setPanel('none');
    setHandoff(fromPanel && expectsSoftKeyboard());
    useCommentBarState.setState({ target: next });
    updateInset();
    scheduleAlign(measureKeyboardHeight() === null && expectsSoftKeyboard());
  }

  function closeBar(restoreFocus: boolean) {
    if (!targetRef.current) return;
    targetRef.current = null;
    panelRef.current = 'none';
    switchingRef.current = false;
    cancelAlign();
    const active = document.activeElement;
    if (active instanceof HTMLElement && barRef.current?.contains(active)) active.blur();
    setTarget(null);
    setPanel('none');
    setHandoff(false);
    // The target goes at once, but the spacer stays until the press that closed the bar has delivered its click
    // and the keyboard has gone: collapsing it now would move the content under the finger, and the click would
    // land on whatever slid there. The store's target is checked, so a bar opened again meanwhile keeps its own.
    // 目标立即清除，但底部留白要等关闭评论栏的那次按下送出点击、键盘收起之后才清除：现在就收起会让手指下的内容移动，
    // 点击会落到移过来的其他内容上。这里检查的是 store 中的目标，因此期间再次打开的评论栏保留自己的留白。
    useCommentBarState.setState({ target: null });
    cancelInsetHold();
    insetTimerRef.current = setTimeout(() => {
      insetTimerRef.current = null;
      if (useCommentBarState.getState().target === null) useCommentBarState.setState({ inset: 0 });
    }, INSET_HOLD_MS);
    const opener = openerRef.current;
    openerRef.current = null;
    if (!restoreFocus || !opener?.isConnected) return;
    // On touch screens, refocusing a text field would bring the keyboard straight back.
    // 在触屏上，重新聚焦输入框会让键盘立即再次弹出。
    if (isTextField(opener) && window.matchMedia?.('(pointer: coarse)').matches) return;
    opener.focus({ preventScroll: true });
  }

  useLayoutEffect(() => {
    actionsRef.current = { open: openFor, close: closeBar, scheduleAlign, updateInset };
  });

  useLayoutEffect(
    () =>
      registerCommentBarHost({
        open: (next) => actionsRef.current?.open(next),
        close: () => actionsRef.current?.close(false),
      }),
    [],
  );

  useEffect(
    () => () => {
      cancelAnimationFrame(alignFrameRef.current);
      if (insetTimerRef.current !== null) clearTimeout(insetTimerRef.current);
    },
    [],
  );

  // The system back gesture closes the bar before it leaves the page.
  // 系统返回手势先关闭评论栏，而不是离开页面。
  useBackToClose(() => actionsRef.current?.close(true), open);

  // Closes on the member's own scroll (a drag or a wheel outside the bar), a press outside it, or Escape
  // with nothing else focused. Presses on controls marked COMMENT_BAR_KEEP_ATTRIBUTE keep the textarea
  // focused, so their tap only retargets the bar.
  // 成员自己滚动页面（在评论栏外拖动或滚动滚轮）、在评论栏外按下，或在没有其他元素获得焦点时按 Escape，都会关闭评论栏。
  // 按下带有 COMMENT_BAR_KEEP_ATTRIBUTE 的控件时输入框保持焦点，其点击只是切换评论栏的目标。
  useEffect(() => {
    const bar = barRef.current;
    if (!open || !bar) return;
    const inBar = (node: EventTarget | null) => node instanceof Node && bar.contains(node);
    const keeps = (node: EventTarget | null) => node instanceof Element && node.closest(`[${COMMENT_BAR_KEEP_ATTRIBUTE}]`) !== null;
    let touchStart: { x: number; y: number } | null = null;
    let wheeled = 0;

    const onPointerDown = (event: PointerEvent) => {
      if (inBar(event.target) || keeps(event.target)) return;
      actionsRef.current?.close(false);
    };
    const onMouseDown = (event: MouseEvent) => {
      if (!inBar(event.target) && keeps(event.target)) event.preventDefault();
    };
    const onTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      touchStart = touch && event.touches.length === 1 && !inBar(event.target) ? { x: touch.clientX, y: touch.clientY } : null;
    };
    const onTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touchStart || !touch) return;
      if (Math.hypot(touch.clientX - touchStart.x, touch.clientY - touchStart.y) <= DRAG_CLOSE_PX) return;
      touchStart = null;
      actionsRef.current?.close(false);
    };
    const onWheel = (event: WheelEvent) => {
      if (inBar(event.target)) return;
      wheeled += Math.abs(event.deltaX) + Math.abs(event.deltaY);
      if (wheeled > DRAG_CLOSE_PX) actionsRef.current?.close(false);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const active = document.activeElement;
      if (active && active !== document.body && !inBar(active)) return;
      event.preventDefault();
      actionsRef.current?.close(true);
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
    document.addEventListener('touchmove', onTouchMove, { capture: true, passive: true });
    window.addEventListener('wheel', onWheel, { passive: true });
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('mousedown', onMouseDown, true);
      document.removeEventListener('touchstart', onTouchStart, true);
      document.removeEventListener('touchmove', onTouchMove, true);
      window.removeEventListener('wheel', onWheel);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // While open, the keyboard and the wrapping text change the bar and the room above it: the page's spacer
  // follows, and the target is aligned again once things hold still.
  // 打开期间，键盘和折行的文字会改变评论栏及其上方的空间：页面的底部留白随之变化，稳定后再次对齐目标。
  useEffect(() => {
    const bar = barRef.current;
    if (!open || !bar) return;
    const viewport = window.visualViewport;
    const refit = () => {
      actionsRef.current?.updateInset();
      actionsRef.current?.scheduleAlign(false);
    };
    viewport?.addEventListener('resize', refit);
    let height = bar.offsetHeight;
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            if (Math.abs(bar.offsetHeight - height) < 1) return;
            height = bar.offsetHeight;
            refit();
          });
    observer?.observe(bar);
    return () => {
      viewport?.removeEventListener('resize', refit);
      observer?.disconnect();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let frame = 0;
    const stop = watchKeyboard((height) => {
      // The held space is gone once the keyboard covers it; the host follows the keyboard in its own animation
      // frame, so the space is released after that.
      // 键盘覆盖了保留的空间后，该空间即已用尽。外层在其动画帧中跟随键盘，因此在那之后再释放。
      if (height === null || height < panelHeightRef.current - 1) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setHandoff(false));
    });
    return () => {
      cancelAnimationFrame(frame);
      stop();
    };
  }, [open]);

  useEffect(() => {
    if (!handoff) return;
    const timer = setTimeout(() => setHandoff(false), HANDOFF_MAX_MS);
    return () => clearTimeout(timer);
  }, [handoff]);

  function notifyTooLong() {
    toast(tr(`评论不能超过 ${MOMENT_COMMENT_MAX} 字`, `Comments can be ${MOMENT_COMMENT_MAX} characters at most.`));
  }

  function readSelection(): TextSelection {
    const element = textareaRef.current;
    const length = textRef.current.length;
    const selection = element && document.activeElement === element ? { start: element.selectionStart, end: element.selectionEnd } : selectionRef.current;
    return { start: Math.min(selection.start, length), end: Math.min(selection.end, length) };
  }

  function rememberSelection() {
    const element = textareaRef.current;
    if (element && document.activeElement === element) selectionRef.current = { start: element.selectionStart, end: element.selectionEnd };
  }

  function focusInput() {
    const element = textareaRef.current;
    if (!element) return;
    // Read before focusing: once focused, the element's own selection is the truth again.
    // 在聚焦之前读取：聚焦之后，元素自身的选区又成为准确的值。
    const { start, end } = readSelection();
    element.focus({ preventScroll: true });
    if (pendingCaretRef.current !== null) return;
    element.setSelectionRange(start, end);
  }

  function capToLimit(element: HTMLTextAreaElement, value: string, adjusted: boolean) {
    let next = value;
    let caret: number | null = adjusted ? element.selectionStart : null;
    if (momentTextLength(next) > MOMENT_COMMENT_MAX) {
      next = capComment(next);
      caret = Math.min(element.selectionStart, next.length);
      notifyTooLong();
    }
    applyText(next, caret);
  }

  function onChange(event: ChangeEvent<HTMLTextAreaElement>) {
    const element = event.target;
    const flat = element.value.replace(LINE_BREAK, ' ');
    // The cap waits for the end of a pinyin composition, which cutting the text would break.
    // 长度上限等到拼音输入结束后再处理，否则截断文字会打断输入。
    if (composingRef.current) {
      applyText(flat, flat !== element.value ? element.selectionStart : null);
      return;
    }
    capToLimit(element, flat, flat !== element.value);
  }

  function send() {
    const current = targetRef.current;
    const value = textRef.current;
    if (!current || !normalizeMomentComment(value)) return;
    // Sent first: if the store refuses, the text is still here to try again. The store announces 评论已发送.
    // 先发送：如果 store 拒绝，文字仍留在这里，可以再试一次。「评论已发送」由 store 播报。
    useFeedStore.getState().sendComment({ postId: current.postId, text: value, replyTo: current.replyTo });
    applyText('', 0);
    closeBar(true);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // keyCode 229 is the Enter that commits a pinyin candidate in Safari, after isComposing has already turned false.
    // keyCode 229 是 Safari 中确认拼音候选词的回车，此时 isComposing 已经变为 false。
    const composing = event.nativeEvent.isComposing || event.keyCode === 229 || composingRef.current;
    if (event.key === 'Enter' && !composing) {
      event.preventDefault();
      send();
    }
  }

  function onBarKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Escape' || !targetRef.current || event.nativeEvent.isComposing || composingRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    closeBar(true);
  }

  function onInputFocus() {
    if (panelRef.current !== 'none' && expectsSoftKeyboard()) setHandoff(true);
    panelRef.current = 'none';
    setPanel('none');
  }

  function onInputBlur(event: FocusEvent<HTMLTextAreaElement>) {
    if (switchingRef.current) {
      switchingRef.current = false;
      return;
    }
    if (!targetRef.current || (event.relatedTarget instanceof Node && barRef.current?.contains(event.relatedTarget))) return;
    // The keyboard was dismissed, or focus went elsewhere. When the window itself lost focus (another app or
    // tab) the textarea is still the active element, and the bar stays for the member's return.
    // 键盘被收起，或焦点移到了别处。如果是整个窗口失去焦点（切到其他应用或标签页），输入框仍是活动元素，评论栏保留到成员回来。
    requestAnimationFrame(() => {
      if (!targetRef.current || panelRef.current !== 'none') return;
      const active = document.activeElement;
      if (active === textareaRef.current || (active instanceof Node && barRef.current?.contains(active))) return;
      closeBar(false);
    });
  }

  function toggleEmoji() {
    if (panelRef.current === 'emoji') {
      panelRef.current = 'none';
      setPanel('none');
      if (expectsSoftKeyboard()) setHandoff(true);
      focusInput();
      return;
    }
    // Measured before the blur, while the keyboard is still fully up. The panel is sized beside the keyboard, so
    // it grows into view as the keyboard goes and the bar stays where it is.
    // 在失焦之前测量，此时键盘仍完全展开。面板按键盘让出的空间计算高度，随键盘收起而显现，评论栏保持不动。
    setPanelHeight(rememberKeyboardHeight() ?? lastKeyboardHeight());
    rememberSelection();
    panelRef.current = 'emoji';
    const element = textareaRef.current;
    if (element && document.activeElement === element) {
      switchingRef.current = true;
      element.blur();
      switchingRef.current = false;
    }
    setHandoff(false);
    setPanel('emoji');
  }

  function insertEmoji(emoji: string) {
    const { start, end } = readSelection();
    const value = textRef.current;
    const next = value.slice(0, start) + emoji + value.slice(end);
    if (momentTextLength(next) > MOMENT_COMMENT_MAX) {
      notifyTooLong();
      return;
    }
    applyText(next, start + emoji.length);
    useDraftsStore.getState().pushRecentEmoji(emoji);
  }

  function backspace() {
    const edit = deleteBackward(textRef.current, readSelection(), []);
    applyText(edit.text, edit.caret);
  }

  /** 「×」: the comment stays, now addressed to the post instead of the person. */
  /** 「×」：文字保留，改为评论这条动态，而不再回复那个人。 */
  function dropReply() {
    const current = targetRef.current;
    if (!current?.replyTo) return;
    writeCommentDraft(targetDraftKey(current), '');
    const next: CommentTarget = { ...current, replyTo: null };
    targetRef.current = next;
    writeCommentDraft(targetDraftKey(next), textRef.current);
    setTarget(next);
    useCommentBarState.setState({ target: next });
  }

  const holding = open && panel === 'none' && handoff;
  const panelBox = { height: besideKeyboard(panelHeight) };
  const placeholder = target ? placeholderFor(target, tr) : tr('评论', 'Comment');
  const replyName = target?.replyTo ? personName(target.replyTo.person, tr) : null;
  const transition = reduced ? 'none' : `transform ${SLIDE_MS}ms ${EASE}, opacity ${SLIDE_MS}ms ${EASE}`;

  return (
    <div
      ref={barRef}
      aria-hidden={open ? undefined : true}
      onKeyDown={onBarKeyDown}
      className="w-full shrink-0 border-t-[0.5px] border-wx-line bg-wx-bar"
      style={{
        transform: open ? OPEN_TRANSFORM : CLOSED_TRANSFORM,
        opacity: open ? 1 : 0,
        pointerEvents: open ? 'auto' : 'none',
        transition,
        paddingLeft: 'var(--safe-left)',
        paddingRight: 'var(--safe-right)',
        paddingBottom: panel !== 'none' || holding ? '0px' : OVERLAY_BOTTOM_INSET,
      }}
    >
      <div className="mx-auto w-full max-w-2xl">
        {replyName ? (
          <div className="flex items-center gap-2 pl-3 pr-1.5 pt-1.5 text-[13px] leading-snug text-wx-meta">
            <span className="min-w-0 flex-1 truncate">{tr(`回复 ${replyName}`, `Reply to ${replyName}`)}</span>
            <button
              type="button"
              tabIndex={open ? 0 : -1}
              onPointerDown={keepFocus}
              onMouseDown={keepFocus}
              onClick={dropReply}
              aria-label={tr('取消回复', 'Cancel reply')}
              className="-my-3 flex h-11 w-11 shrink-0 items-center justify-center text-[#B2B2B2] active:opacity-60"
            >
              <CloseCircleIcon className="h-4 w-4" />
            </button>
          </div>
        ) : null}
        <div className="flex items-end gap-0.5 py-2 pl-2.5 pr-1.5">
          <textarea
            ref={textareaRef}
            rows={1}
            value={text}
            tabIndex={open ? 0 : -1}
            placeholder={placeholder}
            aria-label={placeholder}
            enterKeyHint="send"
            onChange={onChange}
            onKeyDown={onKeyDown}
            onFocus={onInputFocus}
            onBlur={(event) => {
              rememberSelection();
              onInputBlur(event);
            }}
            onSelect={rememberSelection}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={(event) => {
              composingRef.current = false;
              capToLimit(event.currentTarget, event.currentTarget.value.replace(LINE_BREAK, ' '), false);
            }}
            className="block min-h-10 min-w-0 flex-1 resize-none rounded-[4px] bg-white px-2.5 py-[9px] text-[16px] leading-[22px] text-wx-ink caret-brand-700 outline-none focus-visible:outline-none"
          />
          <BarButton label={panel === 'emoji' ? tr('键盘', 'Keyboard') : tr('表情', 'Emoji')} tabbable={open} onClick={toggleEmoji}>
            {panel === 'emoji' ? <KeyboardIcon /> : <EmojiIcon />}
          </BarButton>
          {sendable ? (
            <button
              type="button"
              tabIndex={open ? 0 : -1}
              onPointerDown={keepFocus}
              onMouseDown={keepFocus}
              onClick={send}
              className="group -mb-0.5 flex h-11 shrink-0 items-center px-1"
            >
              <span className="flex h-8 items-center rounded-[4px] bg-brand-800 px-3 text-[15px] font-medium text-white group-active:bg-brand-900">{tr('发送', 'Send')}</span>
            </button>
          ) : null}
        </div>
      </div>
      {open && panel === 'emoji' ? (
        <div className="shrink-0 overflow-hidden" style={panelBox}>
          <EmojiPanel height={panelHeight} canSend={sendable} onInsert={insertEmoji} onBackspace={backspace} onSend={send} />
        </div>
      ) : null}
      {holding ? <div className="shrink-0" style={panelBox} aria-hidden /> : null}
    </div>
  );
}
