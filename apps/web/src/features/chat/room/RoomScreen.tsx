import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useNavigationType, type Location } from 'react-router-dom';
import { canModerateRoom, parseRoomId, type QuotePreview } from '@utmmsc/shared';
import { formatDividerTime } from '../../../shared/format/time';
import { useTr } from '../../../shared/i18n/locale';
import { useSessionStore } from '../../../shared/session/store';
import { ActionSheet } from '../../../shared/ui/ActionSheet';
import { toast } from '../../../shared/ui/toast';
import { Composer } from '../composer/Composer';
import { roomLink } from '../list/conversations';
import { othersUnread, roomById, useOverviewStore } from '../state/overviewStore';
import { useRoomSocket } from '../transport/useRoomSocket';
import { MessageList } from './MessageList';
import { RoomHeader } from './RoomHeader';
import { SystemTip } from './SystemTip';
import type { ComposerHandle, MessageListHandle } from './types';
import { useVisualViewport } from './useVisualViewport';

/** The first connection of a visit usually finishes quickly; the status line waits this long before showing. */
/** 每次进入时的首次连接通常很快完成；状态行等待这么久才显示。 */
const FIRST_STATUS_DELAY_MS = 500;
/** setTimeout cannot wait longer than this. */
/** setTimeout 能等待的最长时间。 */
const TIMER_MAX_MS = 2_147_483_647;

/** True when there is an in-app page to return to, rather than a page opened straight from a link. */
/** 存在可返回的站内页面时为 true，而不是直接从链接打开的页面。 */
function canGoBack(location: Location): boolean {
  if (location.key === 'default') return false;
  const index = (window.history.state as { idx?: unknown } | null)?.idx;
  return typeof index !== 'number' || index > 0;
}

/**
 * One room: the title bar, the message timeline and the composer in a column pinned to the visible
 * viewport. Read state follows WeChat: everything on screen counts as read while the page is visible.
 * Keyed by room in RoomPage, so all state starts fresh when the room changes.
 * 单个房间：标题栏、消息时间线和输入栏组成一列，固定在可见视口内。已读状态与微信一致：页面可见时，进入房间即视为已读。
 * 在 RoomPage 中按房间区分实例，切换房间时所有状态重新开始。
 */
export function RoomScreen({ roomId }: { roomId: string }) {
  const tr = useTr();
  const navigate = useNavigate();
  const location = useLocation();
  const navigationType = useNavigationType();
  const member = useSessionStore((s) => s.member);
  const room = useRoomSocket(roomId);
  const overviewRoom = useOverviewStore((s) => roomById(s.data, roomId));
  const backUnread = useOverviewStore((s) => othersUnread(s.data, roomId));

  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<MessageListHandle>(null);
  const composerRef = useRef<ComposerHandle>(null);
  const unmarkedRef = useRef(false);
  // A return from the chat info page or a reload is not a new push, so it does not slide in again.
  // 从聊天信息页返回或刷新页面不算新进入，不再滑入。
  const [slideIn] = useState(() => navigationType !== 'POP');
  const [muteTarget, setMuteTarget] = useState<string | null>(null);
  const [firstWaitOver, setFirstWaitOver] = useState(false);
  const [everOpen, setEverOpen] = useState(false);
  const [, setMuteExpiry] = useState(0);

  useVisualViewport(rootRef);

  const { meta, status, retrying, fatalError, notice, clearNotice, markRead, mutedUntil, clockSkewMs } = room;
  const kind = meta?.kind ?? parseRoomId(roomId)?.kind ?? 'channel';
  const meId = member?.id ?? '';
  // Direct conversations have no moderation, even when an older cached meta says otherwise.
  // 私聊没有管理操作，即使较早缓存的 meta 另有说法。
  const canModerate = kind === 'channel' && (meta?.canModerate ?? (member ? canModerateRoom(kind, member.role) : false));
  const canMentionAll = canModerate;

  const title = meta?.title ?? overviewRoom?.title ?? (kind === 'direct' ? tr('私聊', 'Direct') : tr('频道', 'Channel'));
  const count = kind === 'channel' && meta ? meta.memberCount : null;
  const muted = overviewRoom?.prefs.muted ?? meta?.prefs.muted ?? false;

  useEffect(() => {
    void useOverviewStore.getState().refresh();
    // Leaving the room refetches the list, so its preview shows what was just sent or received.
    // 离开房间时重新加载列表，预览才会显示刚刚收发的内容。
    return () => void useOverviewStore.getState().refresh({ force: true });
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setFirstWaitOver(true), FIRST_STATUS_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (status === 'open') setEverOpen(true);
  }, [status]);

  // Notices are brief toasts, as in WeChat, rather than a banner that stays on the page.
  // 提示以短暂的浮层显示（与微信一致），而不是常驻页面的横幅。
  useEffect(() => {
    if (!notice) return;
    toast(notice);
    clearNotice();
  }, [notice, clearNotice]);

  // 标为未读 ends once the member opens the chat.
  // 成员打开会话后，「标为未读」即结束。
  const markedUnread = overviewRoom?.prefs.markedUnread === true || meta?.prefs.markedUnread === true;
  useEffect(() => {
    if (!markedUnread || unmarkedRef.current) return;
    unmarkedRef.current = true;
    void useOverviewStore.getState().patchPrefs(roomId, { markedUnread: false });
  }, [markedUnread, roomId]);

  // Everything loaded counts as read while the page is visible. The entry snapshot is taken first, so the
  // unread pill and marker still know where the unread messages began.
  // 页面可见时，已加载的内容都算已读。进入时的未读快照先被记录，未读胶囊和分隔线仍能知道未读从哪里开始。
  const newestId = room.messages[room.messages.length - 1]?.id ?? null;
  const entryReady = room.entry !== null;
  const open = status === 'open';
  useEffect(() => {
    if (!entryReady || newestId === null) return;
    const flush = () => {
      if (document.visibilityState !== 'visible') return;
      if (open) markRead(newestId);
      useOverviewStore.getState().markRoomRead(roomId, newestId);
    };
    flush();
    document.addEventListener('visibilitychange', flush);
    return () => document.removeEventListener('visibilitychange', flush);
  }, [entryReady, newestId, open, markRead, roomId]);

  const mutedUntilMs = mutedUntil ? Date.parse(mutedUntil) : Number.NaN;
  const mutedNow = Number.isFinite(mutedUntilMs) && mutedUntilMs > Date.now() + clockSkewMs;
  useEffect(() => {
    if (!Number.isFinite(mutedUntilMs)) return;
    const wait = mutedUntilMs - (Date.now() + clockSkewMs);
    if (wait <= 0) return;
    // Re-render once the mute ends, so the composer comes back without a reload.
    // 禁言结束时重新渲染，输入栏无需刷新即可恢复。
    const timer = setTimeout(() => setMuteExpiry((n) => n + 1), Math.min(wait + 250, TIMER_MAX_MS));
    return () => clearTimeout(timer);
  }, [mutedUntilMs, clockSkewMs]);

  let disabledNotice: string | null = null;
  if (room.canPost === false) {
    if (kind === 'direct') disabledNotice = tr('你无法在此聊天中发言', 'You cannot send messages in this chat');
    else if (meta?.postPolicy === 'staff') disabledNotice = tr('仅负责人及以上可发言', 'Only staff can post here');
    else disabledNotice = tr('你不能在此频道发言', 'You cannot post in this channel');
  } else if (mutedNow && mutedUntil) {
    const until = formatDividerTime(new Date(mutedUntilMs - clockSkewMs).toISOString());
    disabledNotice = tr(`你已被禁言，${until} 后可发言`, `You are muted until ${until}`);
  }

  const goBack = useCallback(() => {
    if (canGoBack(location)) navigate(-1);
    else navigate('/chat', { replace: true });
  }, [location, navigate]);

  const openInfo = useCallback(() => navigate(`${roomLink(roomId)}/info`), [navigate, roomId]);

  const listCallbacks = useMemo(
    () => ({
      onOpenProfile: (id: string) => navigate(`/directory/${encodeURIComponent(id)}`),
      // Each of these is called straight from the member's tap, so iOS still raises the keyboard.
      // 以下回调都直接在成员点按时调用，iOS 因此仍会弹出键盘。
      onMentionAuthor: (author: { id: string; displayName: string }) => composerRef.current?.insertMention(author),
      onQuote: (quote: QuotePreview) => composerRef.current?.setQuote(quote),
      onReEdit: (text: string) => composerRef.current?.restoreText(text),
      onMute: (memberId: string) => setMuteTarget(memberId),
      onBackgroundTap: () => composerRef.current?.collapse(),
    }),
    [navigate],
  );

  const onSent = useCallback(() => listRef.current?.scrollToBottom(true), []);

  function chooseMute(minutes: number) {
    if (muteTarget) room.mute(muteTarget, minutes);
  }

  const headerStatus = fatalError || (!everOpen && !firstWaitOver) ? null : status;

  return (
    <div ref={rootRef} className="fixed inset-x-0 top-0 flex h-full flex-col overflow-hidden bg-wx-canvas">
      <div className={`mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col bg-wx-canvas ${slideIn ? 'wx-push-in' : ''}`}>
        <RoomHeader
          title={title}
          count={count}
          status={headerStatus}
          retrying={retrying}
          othersUnread={backUnread}
          muted={muted}
          onBack={goBack}
          onMore={fatalError ? undefined : openInfo}
        />
        {fatalError ? (
          <div className="flex min-h-0 flex-1 flex-col justify-center" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
            <SystemTip text={fatalError} />
          </div>
        ) : (
          <>
            <MessageList ref={listRef} room={room} kind={kind} meId={meId} canModerate={canModerate} {...listCallbacks} />
            <Composer ref={composerRef} roomId={roomId} kind={kind} room={room} disabledNotice={disabledNotice} canMentionAll={canMentionAll} onSent={onSent} />
          </>
        )}
      </div>
      {muteTarget ? (
        <ActionSheet
          title={tr('禁言时长', 'Mute for')}
          options={[
            { label: tr('10 分钟', '10 minutes'), onSelect: () => chooseMute(10) },
            { label: tr('1 小时', '1 hour'), onSelect: () => chooseMute(60) },
            { label: tr('1 天', '1 day'), onSelect: () => chooseMute(1440) },
          ]}
          onClose={() => setMuteTarget(null)}
        />
      ) : null}
    </div>
  );
}
