import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode, type TouchEvent } from 'react';
import { useLocaleStore, useTr } from '../../../shared/i18n/locale';
import { useSessionStore } from '../../../shared/session/store';
import { toast } from '../../../shared/ui/toast';
import { WxSpinner } from '../../../shared/ui/WxSpinner';
import { ImageViewer, type ViewerImage } from './ImageViewer';
import { JumpPills } from './JumpPills';
import { LiveAnnouncer } from './LiveAnnouncer';
import { MessageRow, type RowActions, type RowMe } from './MessageRow';
import { SystemTip, TimeDivider, UnreadMarker, useMinuteTick } from './SystemTip';
import { buildTimeline, canModerateAuthor, translatorFor, UNREAD_MARKER_KEY, type TimelineItem } from './timeline';
import type { MessageListHandle, MessageListProps } from './types';
import { useHistorySentinel } from './useHistorySentinel';
import { useScrollAnchor } from './useScrollAnchor';

/** Within this distance of the bottom the list counts as stuck and follows new messages. */
/** 距底部不超过此距离时，列表视为贴底并跟随新消息。 */
const STUCK_PX = 80;
const TRIM_AT = 400;
const TRIM_KEEP = 200;
const DRAG_BLUR_PX = 12;
const TAP_SLOP_PX = 10;
/** How long scroll events are not allowed to unstick the list during its own smooth scroll. */
/** 列表自身平滑滚动期间，滚动事件在这段时间内不能解除贴底。 */
const SMOOTH_GUARD_MS = 600;
const MARKER_MARGIN_PX = 8;
/** A jump farther than this many screens is instant rather than smooth. */
/** 超过这么多屏的跳转直接到位，而不是平滑滚动。 */
const SMOOTH_MAX_SCREENS = 1.5;

type ScrollRequest = { kind: 'center'; id: number; resolve: () => void } | { kind: 'marker' };
type RowPosition = 'missing' | 'above' | 'visible' | 'below';

function trNow(zh: string, en: string): string {
  return translatorFor(useLocaleStore.getState().locale)(zh, en);
}

function reducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

function distanceFromBottom(list: HTMLElement): number {
  return list.scrollHeight - list.scrollTop - list.clientHeight;
}

function positionOf(list: HTMLElement, element: HTMLElement | null): RowPosition {
  if (!element) return 'missing';
  const top = element.offsetTop - list.scrollTop;
  if (top + element.offsetHeight <= 0) return 'above';
  if (top >= list.clientHeight) return 'below';
  return 'visible';
}

function rowById(list: HTMLElement, id: number): HTMLElement | null {
  return list.querySelector<HTMLElement>(`[data-id="${id}"]`);
}

/** Restarts the row highlight even when it is already running. */
/** 重新开始行高亮，即使它正在进行中。 */
function flash(row: HTMLElement) {
  row.classList.remove('wx-flash');
  void row.offsetWidth;
  row.classList.add('wx-flash');
  row.addEventListener('animationend', () => row.classList.remove('wx-flash'), { once: true });
}

interface EntryProps {
  item: TimelineItem;
  kind: 'channel' | 'direct';
  me: RowMe;
  mediaToken: string | null;
  capable: boolean;
  canPost: boolean | null;
  canModerate: boolean;
  actions: RowActions;
  onReEdit: (id: number) => void;
}

const TimelineEntry = memo(function TimelineEntry({ item, onReEdit, ...row }: EntryProps) {
  const tr = useTr();
  let id: number | undefined;
  let content: ReactNode = null;
  switch (item.type) {
    case 'join_tip':
      content = <SystemTip text={item.text} />;
      break;
    case 'divider':
      content = <TimeDivider text={item.text} />;
      break;
    case 'unread':
      content = <UnreadMarker label={tr('以下为新消息', 'New messages')} />;
      break;
    case 'system':
    case 'removed':
      id = item.id;
      content = <SystemTip text={item.text} />;
      break;
    case 'recall':
      id = item.id;
      content = <SystemTip text={item.text} action={item.reEdit ? { label: tr('重新编辑', 'Re-edit'), onClick: () => onReEdit(item.id) } : undefined} />;
      break;
    case 'message':
    case 'pending':
      id = item.type === 'message' ? item.message.id : undefined;
      content = <MessageRow item={item} {...row} />;
      break;
  }
  return (
    <div data-key={item.key} data-id={id}>
      {content}
    </div>
  );
});

/**
 * The scrolling message timeline. It opens at the bottom, follows new messages while within 80px of the
 * bottom, keeps the reading position when older pages are prepended or rows change size, pages older
 * history from a top sentinel, and shows WeChat's jump pills, tips and image viewer.
 * 可滚动的消息时间线。打开时位于底部；距底部 80px 以内时跟随新消息；向上插入更早的消息或行高变化时保持阅读位置；
 * 通过顶部哨兵加载更早的历史；并显示微信的跳转胶囊、提示和图片查看器。
 */
export const MessageList = forwardRef<MessageListHandle, MessageListProps>(function MessageList(props, ref) {
  const { room, kind, meId, canModerate } = props;
  const { messages, pending, hasMore, reachedFloor, floorReason, loadingOlder, olderFailed, entry, mediaToken, capable, canPost, synced } = room;
  const { reeditText, retryOlder, trimOldest } = room;
  const roomTitle = room.meta?.title ?? null;
  const locale = useLocaleStore((s) => s.locale);
  const tr = useMemo(() => translatorFor(locale), [locale]);
  const member = useSessionStore((s) => s.member);
  const now = useMinuteTick();

  const listRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  const stuckRef = useRef(true);
  const positionedRef = useRef(false);
  const smoothUntilRef = useRef(0);
  const newestIdRef = useRef<number | null>(null);
  const seenPendingRef = useRef<Set<string>>(new Set());
  const dismissedRef = useRef({ unread: false, mention: false });
  const tapRef = useRef({ x: 0, y: 0, moved: false });
  const touchYRef = useRef<number | null>(null);
  const previousItems = useRef<TimelineItem[]>([]);
  /** Open message menus; while any is open a stuck list stops following new messages. */
  /** 打开着的消息菜单数；只要有一个打开，贴底的列表就不再跟随新消息。 */
  const holdsRef = useRef(0);

  const [stuck, setStuck] = useState(true);
  const [markerId, setMarkerId] = useState<number | null>(null);
  const [below, setBelow] = useState(0);
  const [pills, setPills] = useState({ unread: false, mention: false });
  const [viewer, setViewer] = useState<{ id: number; rect: DOMRect | null } | null>(null);
  const [scrollRequest, setScrollRequest] = useState<ScrollRequest | null>(null);
  /** Jumps still paging towards their target. */
  /** 仍在向目标翻页的跳转数。 */
  const [jumps, setJumps] = useState(0);

  useLayoutEffect(() => {
    propsRef.current = props;
  });

  const me = useMemo<RowMe>(() => ({ id: meId, displayName: member?.displayName ?? '', avatarKey: member?.avatarKey ?? null }), [meId, member?.displayName, member?.avatarKey]);
  const exemptIds = room.meta?.moderationExempt;
  const exempt = useMemo(() => new Set(exemptIds ?? []), [exemptIds]);

  const items = useMemo(
    () =>
      buildTimeline(
        {
          messages,
          pending,
          meId,
          kind,
          hasMore,
          reachedFloor,
          floorReason,
          roomTitle,
          unreadMarkerBeforeId: markerId,
          canReEdit: (id) => reeditText(id) !== null,
          locale,
          nowMs: now,
        },
        previousItems.current,
      ),
    [messages, pending, meId, kind, hasMore, reachedFloor, floorReason, roomTitle, markerId, reeditText, locale, now],
  );

  useLayoutEffect(() => {
    previousItems.current = items;
  }, [items]);

  const setStuckBoth = useCallback((next: boolean) => {
    stuckRef.current = next;
    setStuck(next);
    if (next) setBelow(0);
  }, []);

  const updatePills = useCallback(() => {
    const list = listRef.current;
    const { entry: current, synced: roomSynced } = propsRef.current.room;
    // A room shown from its cached snapshot is still fetching the unread rows, which would count as missing.
    // The pills wait for the first sync, so they never flash for messages that end up on screen.
    // 从缓存快照显示的房间仍在获取未读消息，这些消息此时会被当作不存在。胶囊等到第一次同步完成后才判断，因此不会为最终显示在屏幕上的消息闪现。
    if (!list || !current || !positionedRef.current || !roomSynced) return;
    const dismissed = dismissedRef.current;
    if (!dismissed.mention && current.firstMentionId !== null && positionOf(list, rowById(list, current.firstMentionId)) === 'visible') {
      dismissed.mention = true;
    }
    let firstUnread: RowPosition = 'missing';
    if (!dismissed.unread && current.unreadCount > 0 && current.firstUnreadId !== null) {
      firstUnread = positionOf(list, rowById(list, current.firstUnreadId));
      const marker = positionOf(list, list.querySelector<HTMLElement>(`[data-key="${UNREAD_MARKER_KEY}"]`));
      // Seen on screen, by hand or right after entering: the pill is no longer needed.
      // 已在屏幕上出现过（手动滚到或刚进入时即可见）：不再需要胶囊。
      if (firstUnread === 'visible' || firstUnread === 'below' || marker === 'visible') dismissed.unread = true;
    }
    const mention = !dismissed.mention && current.firstMentionId !== null;
    const unread = !dismissed.unread && current.unreadCount > 0 && current.firstUnreadId !== null;
    // The marker is placed once the first unread row is loaded above the screen, so scrolling up by hand finds it;
    // a row that is not loaded yet gets its marker when the pill is tapped.
    // 第一条未读消息已加载且位于屏幕上方时放置分隔线，手动向上滚动即可看到；尚未加载的消息在点按胶囊时再放置。
    if (unread && firstUnread === 'above') setMarkerId((id) => id ?? current.firstUnreadId);
    setPills((prev) => (prev.mention === mention && prev.unread === unread ? prev : { mention, unread }));
  }, []);

  const onFrame = useCallback(() => {
    const list = listRef.current;
    if (!list || !positionedRef.current) return;
    const nowStuck = distanceFromBottom(list) <= STUCK_PX;
    // While the list runs its own smooth scroll to the bottom, the frames on the way do not unstick it.
    // 列表自身平滑滚动到底部的过程中，途中的帧不会解除贴底。
    if (nowStuck !== stuckRef.current && (nowStuck || performance.now() >= smoothUntilRef.current)) setStuckBoth(nowStuck);
    updatePills();
  }, [setStuckBoth, updatePills]);

  const anchor = useScrollAnchor(listRef, { isStuck: () => stuckRef.current, onFrame });

  /** `smooth` animates short distances only; `always` animates however far the bottom is. */
  /** `smooth` 只为较短的距离加动画；`always` 无论距离多远都加动画。 */
  const scrollToBottom = useCallback(
    (smooth: boolean, always = false) => {
      const list = listRef.current;
      if (!list) return;
      const far = distanceFromBottom(list) > list.clientHeight * SMOOTH_MAX_SCREENS;
      if (smooth && (always || !far) && !reducedMotion()) {
        smoothUntilRef.current = performance.now() + SMOOTH_GUARD_MS;
        list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
      } else {
        smoothUntilRef.current = 0;
        list.scrollTop = list.scrollHeight;
      }
      setStuckBoth(true);
    },
    [setStuckBoth],
  );

  const settleAfterJump = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    smoothUntilRef.current = 0;
    setStuckBoth(distanceFromBottom(list) <= STUCK_PX);
    anchor.reset();
  }, [anchor, setStuckBoth]);

  const jumpTo = useCallback(async (id: number) => {
    setJumps((n) => n + 1);
    try {
      const ok = await propsRef.current.room.loadUntil(id);
      if (!ok) {
        toast(trNow('无法定位到原消息', 'Could not find the original message'));
        return;
      }
      await new Promise<void>((resolve) => setScrollRequest({ kind: 'center', id, resolve }));
    } finally {
      setJumps((n) => n - 1);
    }
  }, []);

  useImperativeHandle(ref, () => ({ scrollToBottom: (smooth = false) => scrollToBottom(smooth), jumpTo }), [scrollToBottom, jumpTo]);

  const closeViewer = useCallback(() => setViewer(null), []);
  const actions = useMemo<RowActions>(() => {
    const current = () => propsRef.current;
    const holdFollow = () => {
      holdsRef.current += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holdsRef.current -= 1;
        if (holdsRef.current > 0) return;
        // Catch up with what arrived meanwhile, unless the member scrolled away, which the next frame reports.
        // 补上期间到达的消息，除非成员已经滚走；这一点在下一帧才能得知。
        requestAnimationFrame(() => {
          if (holdsRef.current === 0 && stuckRef.current) scrollToBottom(true);
        });
      };
    };
    return {
      holdFollow,
      openProfile: (memberId) => current().onOpenProfile(memberId),
      mentionAuthor: (author) => current().onMentionAuthor(author),
      quote: (quote) => current().onQuote(quote),
      recall: (id) => current().room.recall(id),
      hide: (id) => current().room.hide(id),
      removeAsModerator: (id) => current().room.removeAsModerator(id),
      mute: (memberId) => current().onMute(memberId),
      resend: (clientId) => current().room.resend(clientId),
      discard: (clientId) => current().room.discard(clientId),
      jumpTo: (id) => void jumpTo(id),
      openImage: (id, rect) => setViewer({ id, rect }),
      clockSkewMs: () => current().room.clockSkewMs,
      listElement: () => listRef.current,
    };
  }, [jumpTo, scrollToBottom]);

  const onReEdit = useCallback((id: number) => {
    const text = propsRef.current.room.reeditText(id);
    if (text !== null) propsRef.current.onReEdit(text);
  }, []);

  // Position on every change of rows: the first render opens at the bottom before paint, your own new
  // message always goes to the bottom, a stuck list follows new messages, and otherwise the reading
  // position is restored from the anchor row.
  // 每次行变化时定位：首次渲染在绘制前直接到底部；自己的新消息总是滚到底部；贴底时跟随新消息；其他情况从锚点行恢复阅读位置。
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const newest = messages[messages.length - 1]?.id ?? null;
    const previousNewest = newestIdRef.current;
    newestIdRef.current = newest;
    const added = pending.some((p) => !seenPendingRef.current.has(p.clientId));
    seenPendingRef.current = new Set(pending.map((p) => p.clientId));

    if (!positionedRef.current) {
      if (items.length === 0) return;
      positionedRef.current = true;
      list.scrollTop = list.scrollHeight;
      setStuckBoth(true);
      anchor.record();
      return;
    }
    if (added) {
      scrollToBottom(true);
      return;
    }
    const appended = newest !== null && previousNewest !== null && newest > previousNewest;
    if (!stuckRef.current) {
      if (appended) {
        const arrived = messages.filter((m) => m.id > previousNewest && m.kind === 'user' && m.author.id !== meId && !m.recalled && !m.deleted).length;
        if (arrived > 0) setBelow((n) => n + arrived);
      }
      anchor.restore();
      return;
    }
    if (holdsRef.current > 0) {
      anchor.restore();
      return;
    }
    if (appended) scrollToBottom(true);
    else if (performance.now() < smoothUntilRef.current) list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
    else list.scrollTop = list.scrollHeight;
  }, [items, messages, pending, meId, loadingOlder, olderFailed, anchor, scrollToBottom, setStuckBoth]);

  useLayoutEffect(() => {
    updatePills();
  }, [items, entry, synced, updatePills]);

  useLayoutEffect(() => {
    const list = listRef.current;
    const request = scrollRequest;
    if (!list || !request) return;
    setScrollRequest(null);
    if (request.kind === 'center') {
      const row = rowById(list, request.id);
      if (row) {
        list.scrollTop = row.offsetTop - (list.clientHeight - row.offsetHeight) / 2;
        flash(row);
      } else {
        toast(tr('无法定位到原消息', 'Could not find the original message'));
      }
      request.resolve();
    } else {
      const marker = list.querySelector<HTMLElement>(`[data-key="${UNREAD_MARKER_KEY}"]`);
      if (marker) list.scrollTop = marker.offsetTop - MARKER_MARGIN_PX;
    }
    settleAfterJump();
  }, [scrollRequest, settleAfterJump, tr]);

  // Rows that grow or shrink later (images, translations, the keyboard) keep the bottom pinned while
  // stuck and keep the anchor row in place otherwise.
  // 之后变高或变矮的行（图片、译文、键盘）：贴底时保持在底部，否则保持锚点行不动。
  useEffect(() => {
    const list = listRef.current;
    const content = contentRef.current;
    if (!list || !content || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (!positionedRef.current) return;
      if (!stuckRef.current || holdsRef.current > 0) anchor.restore();
      else if (performance.now() < smoothUntilRef.current) list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
      else list.scrollTop = list.scrollHeight;
    });
    observer.observe(list);
    observer.observe(content);
    return () => observer.disconnect();
  }, [anchor]);

  useHistorySentinel({
    rootRef: listRef,
    sentinelRef,
    hasMore,
    loadingOlder,
    canLoad: () => positionedRef.current && !propsRef.current.room.olderFailed,
    loadOlder: () => propsRef.current.room.loadOlder(),
    onBeforeLoad: () => {
      if (!stuckRef.current) anchor.record();
    },
    version: items,
  });

  // A jump pages back while the list stays pinned to the bottom, so trimming waits until no jump, page
  // or scroll request is outstanding; otherwise it would drop the rows the jump is loading towards.
  // 跳转在列表保持贴底的情况下向前翻页，因此裁剪要等到没有进行中的跳转、翻页或滚动请求时才进行；否则会丢掉跳转正在加载的那些消息。
  useEffect(() => {
    if (stuck && messages.length > TRIM_AT && jumps === 0 && !loadingOlder && !scrollRequest) trimOldest(TRIM_KEEP);
  }, [stuck, messages.length, jumps, loadingOlder, scrollRequest, trimOldest]);

  const images = useMemo<ViewerImage[]>(
    () =>
      messages.flatMap((m) => (m.kind === 'user' && !m.recalled && !m.deleted && m.imageKey ? [{ id: m.id, imageKey: m.imageKey, width: m.imageWidth, height: m.imageHeight }] : [])),
    [messages],
  );

  const thumbRect = useCallback((id: number) => {
    const list = listRef.current;
    const thumb = list ? rowById(list, id)?.querySelector<HTMLElement>('[data-thumb]') : null;
    if (!list || !thumb) return null;
    const rect = thumb.getBoundingClientRect();
    const bounds = list.getBoundingClientRect();
    return rect.bottom > bounds.top && rect.top < bounds.bottom ? rect : null;
  }, []);

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    tapRef.current = { x: event.clientX, y: event.clientY, moved: false };
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const tap = tapRef.current;
    if (!tap.moved && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > TAP_SLOP_PX) tap.moved = true;
  }

  function onClick(event: MouseEvent<HTMLDivElement>) {
    const target = event.target;
    // Taps inside a portal (menus, sheets) bubble here through React but are not inside the list.
    // 浮层（菜单、操作表）中的点按会经 React 冒泡到这里，但不在列表之内。
    if (!(target instanceof Element) || !listRef.current?.contains(target) || tapRef.current.moved) return;
    if (target.closest('button, a, input, textarea, [data-interactive]')) return;
    props.onBackgroundTap();
  }

  function onTouchStart(event: TouchEvent<HTMLDivElement>) {
    touchYRef.current = event.touches[0]?.clientY ?? null;
    smoothUntilRef.current = 0;
  }

  function onTouchMove(event: TouchEvent<HTMLDivElement>) {
    const startY = touchYRef.current;
    const y = event.touches[0]?.clientY;
    if (startY === null || y === undefined || Math.abs(y - startY) <= DRAG_BLUR_PX) return;
    touchYRef.current = null;
    if (document.activeElement instanceof HTMLTextAreaElement) document.activeElement.blur();
  }

  async function jumpToUnread() {
    const current = propsRef.current.room.entry;
    if (!current || current.firstUnreadId === null) return;
    dismissedRef.current.unread = true;
    setPills((prev) => ({ ...prev, unread: false }));
    setMarkerId(current.firstUnreadId);
    setJumps((n) => n + 1);
    try {
      await propsRef.current.room.loadUntil(current.firstUnreadId);
      setScrollRequest({ kind: 'marker' });
    } finally {
      setJumps((n) => n - 1);
    }
  }

  function jumpToMention() {
    const current = propsRef.current.room.entry;
    if (!current || current.firstMentionId === null) return;
    dismissedRef.current.mention = true;
    setPills((prev) => ({ ...prev, mention: false }));
    void jumpTo(current.firstMentionId);
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-wx-canvas">
      <div
        ref={listRef}
        className="wx-no-anchor relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
        style={{ overscrollBehaviorY: 'contain' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onClick={onClick}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onWheel={() => {
          smoothUntilRef.current = 0;
        }}
      >
        <div ref={contentRef} className="pb-2 pt-1" style={{ paddingLeft: 'var(--safe-left)', paddingRight: 'var(--safe-right)' }}>
          <div ref={sentinelRef} className="h-px" aria-hidden />
          {loadingOlder ? (
            <div className="flex h-11 items-center justify-center">
              <WxSpinner label={tr('正在加载更早的消息', 'Loading earlier messages')} />
            </div>
          ) : olderFailed ? (
            <div className="flex justify-center">
              <button type="button" onClick={retryOlder} className="min-h-11 px-4 text-[13px] text-wx-meta">
                {tr('加载失败，点击重试', 'Couldn’t load. Tap to retry')}
              </button>
            </div>
          ) : null}
          {items.map((item) => (
            <TimelineEntry
              key={item.key}
              item={item}
              kind={kind}
              me={me}
              mediaToken={mediaToken}
              capable={capable}
              canPost={canPost}
              canModerate={item.type === 'message' ? canModerateAuthor(canModerate, item.own, item.message.author.id, exempt) : canModerate}
              actions={actions}
              onReEdit={onReEdit}
            />
          ))}
        </div>
      </div>
      <JumpPills
        unread={pills.unread && entry ? entry.unreadCount : null}
        mention={pills.mention}
        below={stuck ? 0 : below}
        onUnread={() => void jumpToUnread()}
        onMention={jumpToMention}
        onBelow={() => scrollToBottom(true, true)}
      />
      <LiveAnnouncer messages={messages} meId={meId} stuck={stuck} />
      {viewer ? <ImageViewer images={images} startId={viewer.id} startRect={viewer.rect} mediaToken={mediaToken} thumbRect={thumbRect} onClose={closeViewer} /> : null}
    </div>
  );
});
