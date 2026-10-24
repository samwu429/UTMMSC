import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { flushSync } from 'react-dom';
import { useLocation, useNavigate, useNavigationType, type Location } from 'react-router-dom';
import type { MomentAlbumOwner } from '@utmmsc/shared';
import { useTr } from '../../../shared/i18n/locale';
import { useSessionStore } from '../../../shared/session/store';
import { useStatusBarColor } from '../../../shared/ui/useStatusBarColor';
import { WX_COLORS } from '../../../shared/ui/wxTokens';
import { announce, MomentsLiveRegion } from '../announce';
import { momentsApi } from '../api';
import { CommentBarHost } from '../comment/CommentBarHost';
import { useCommentBar, type CommentBarController } from '../comment/useCommentBar';
import { CameraButton, PostSheet } from '../components/CameraButton';
import { FeedEmpty, FeedError, FeedSkeleton, ListFooter, OfflineBanner, PullIndicator } from '../components/FeedStates';
import { MomentItem } from '../components/MomentItem';
import { MomentsCover } from '../components/MomentsCover';
import { MomentsHeader } from '../components/MomentsHeader';
import { NewPostsPill, scrollPageToTop } from '../components/NewPostsPill';
import { NoticeBubble } from '../components/NoticeBubble';
import { MediaPicker, type MediaPickerHandle } from '../composer/MediaPicker';
import { MomentComposer, type ComposerStart } from '../composer/MomentComposer';
import { useHeaderProgress } from '../hooks/useHeaderProgress';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
import { useScrollRestore } from '../hooks/useScrollRestore';
import { HEADER_HEIGHT } from '../layout/pull';
import { HOME_FEED, findMediaCell, type MediaOpenRequest, type MomentView } from '../model';
import { useFeedList, useFeedStore, useHomeFeedSync, useMomentView, useMomentViews, usePinnedLocalMedia } from '../state/feedStore';
import { MomentImageViewer } from '../viewer/MomentImageViewer';
import { primeMomentVideo, VideoPlayer } from '../viewer/VideoPlayer';

const ROOT: CSSProperties = {
  paddingTop: 'var(--safe-top)',
  paddingLeft: 'var(--safe-left)',
  paddingRight: 'var(--safe-right)',
};

const COLUMN: CSSProperties = { minHeight: 'calc(100dvh - var(--safe-top))' };

/** True when there is an in-app page to return to, rather than a page opened straight from a link or a push. */
/** 存在可返回的站内页面时为 true，而不是直接从链接或推送打开的页面。 */
function canGoBack(location: Location): boolean {
  if (location.key === 'default') return false;
  const index = (window.history.state as { idx?: unknown } | null)?.idx;
  return typeof index !== 'number' || index > 0;
}

/**
 * Overlays and sheets sit outside the content or are fixed inside it (the cover sheet); a drag that starts on
 * one of them belongs to it, never to the page's pull.
 * 浮层和菜单要么在内容之外，要么在内容中以 fixed 定位（封面菜单）；从它们上面开始的拖动属于它们自己，绝不属于页面的下拉。
 */
function startsOnPage(target: EventTarget | null, content: HTMLElement): boolean {
  if (!(target instanceof Element) || !content.contains(target)) return false;
  for (let node: Element | null = target; node && node !== content; node = node.parentElement) {
    if (getComputedStyle(node).position === 'fixed') return false;
  }
  return true;
}

interface OpenedMedia {
  postId: string;
  index: number;
  rect: DOMRect | null;
  kind: 'image' | 'video';
}

/** The viewer or the player for a tapped cell; it closes itself when the post leaves the store. */
/** 被点击格子的图片查看器或视频播放器；这条动态离开 store 时自动关闭。 */
function OpenedMediaLayer({
  opened,
  mediaToken,
  onClose,
  onComment,
}: {
  opened: OpenedMedia;
  mediaToken: string | null;
  onClose: () => void;
  onComment: (view: MomentView, index: number) => void;
}) {
  const view = useMomentView(opened.postId);
  const media = view?.post.media[opened.index] ?? null;
  const gone = !view || !media || media.kind !== opened.kind;
  // The player keeps the blob URL it started with, so this device's copies stay until the layer closes.
  // 播放器沿用开始时的 blob URL，因此本设备的副本保留到这一层关闭为止。
  usePinnedLocalMedia(opened.postId);

  useEffect(() => {
    if (gone) onClose();
  }, [gone, onClose]);

  if (!view || !media || gone) return null;
  if (media.kind === 'video') {
    return <VideoPlayer media={media} localMedia={view.localMedia?.[opened.index] ?? null} mediaToken={mediaToken} startRect={opened.rect} onClose={onClose} />;
  }
  return (
    <MomentImageViewer
      view={view}
      startIndex={opened.index}
      startRect={opened.rect}
      mediaToken={mediaToken}
      onClose={onClose}
      onLike={() => useFeedStore.getState().toggleLike(view.post.id)}
      onComment={() => onComment(view, opened.index)}
    />
  );
}

/**
 * /discover/feed, the home feed of 好友动态, outside the tab shell. The document scrolls (native momentum,
 * status-bar tap to the top, no nested scroller on iPhone); only the comment bar is a fixed layer pinned to
 * the visual viewport. A white column carries the own cover, the notice bubble and the cards; the header
 * fades in over the cover, pull to refresh follows each platform, newer posts wait behind 有 N 条新动态, and
 * the composer replaces the column in document flow while the column stays mounted and hidden. Coming back
 * (a back navigation) restores the place; a fresh visit merges what waited and starts at the top.
 * /discover/feed，好友动态首页，位于标签外壳之外。由文档滚动（系统惯性滚动、轻触状态栏回到顶部，iPhone 上没有嵌套滚动容器）；
 * 只有评论栏是贴合可视视口的固定层。白色内容栏中依次是自己的封面、消息气泡和动态卡片；顶栏在封面上方渐显，下拉刷新按平台各自实现，
 * 更新的动态等在「有 N 条新动态」后面；编辑器在文档流中替换内容栏，内容栏保持挂载并隐藏。返回本页（后退导航）时恢复阅读位置；
 * 重新进入时合并等待中的动态并从顶部开始。
 */
export function MomentsPage() {
  const tr = useTr();
  const navigate = useNavigate();
  const location = useLocation();
  const navigationType = useNavigationType();
  const member = useSessionStore((s) => s.member);
  const sessionToken = useSessionStore((s) => s.mediaToken);
  const feedToken = useFeedStore((s) => s.mediaToken);
  const online = useFeedStore((s) => s.online);
  const list = useFeedList(HOME_FEED);
  const views = useMomentViews(HOME_FEED);
  const bar = useCommentBar();
  const mediaToken = feedToken ?? sessionToken;

  const [composer, setComposer] = useState<ComposerStart | null>(null);
  const [sheet, setSheet] = useState(false);
  const [opened, setOpened] = useState<OpenedMedia | null>(null);
  const [friendCount, setFriendCount] = useState<number | null>(null);
  const [freshVisit] = useState(() => navigationType !== 'POP');

  const rootRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const pickerRef = useRef<MediaPickerHandle>(null);
  const viewsRef = useRef(views);
  const barRef = useRef<CommentBarController>(bar);
  const tokenRef = useRef(mediaToken);

  useLayoutEffect(() => {
    viewsRef.current = views;
    barRef.current = bar;
    tokenRef.current = mediaToken;
  });

  const composing = composer !== null;
  const hasContent = views.length > 0;
  const ready = list.status === 'ready' || hasContent;
  const loading = !hasContent && (list.status === 'idle' || list.status === 'loading');
  const empty = list.status === 'ready' && !hasContent;

  useStatusBarColor(WX_COLORS.canvas);
  // AppShell is not mounted on moments pages, so the page runs the badge checks (every minute while visible)
  // and fetches newer posts into incoming whenever the badge reports some.
  // 动态页面不挂载 AppShell，因此由页面自己检查角标（显示期间每分钟一次），角标报告有新动态时把它们取到 incoming 中。
  useHomeFeedSync();

  // A fresh visit starts at the top, where open() merges what waited behind the pill; a back navigation keeps
  // the place. Declared before useScrollRestore and before open(), which both read the place set here.
  // 重新进入时从顶部开始，open() 会在顶部合并等在提示条后面的动态；后退导航保留原来的位置。写在 useScrollRestore 和 open() 之前，
  // 两者读到的都是这里设置的位置。
  useLayoutEffect(() => {
    if (freshVisit) useFeedStore.getState().saveScroll(HOME_FEED, 0);
  }, [freshVisit]);

  useScrollRestore(HOME_FEED, { ready, paused: composing });
  const pastCover = useHeaderProgress(headerRef);

  useEffect(() => {
    useFeedStore.getState().open(HOME_FEED);
  }, []);

  // The composer starts at the top of the page; closing it restores the feed's place (useScrollRestore).
  // 编辑器从页面顶部开始；关闭后恢复信息流原来的位置（useScrollRestore）。
  useLayoutEffect(() => {
    if (composing) window.scrollTo(0, 0);
  }, [composing]);

  // Which empty state: with no friends the way forward is 通讯录.
  // 显示哪种空状态：没有好友时，出路是「通讯录」。
  useEffect(() => {
    if (!empty || friendCount !== null) return;
    let cancelled = false;
    momentsApi
      .audience()
      .then((res) => {
        if (!cancelled) setFriendCount(res.friends);
      })
      .catch(() => {
        if (!cancelled) setFriendCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, [empty, friendCount]);

  const { refreshing } = usePullToRefresh({
    rootRef,
    contentRef,
    enabled: !composing,
    startsPull: startsOnPage,
    onRefresh: async () => {
      await useFeedStore.getState().refresh(HOME_FEED);
      if (!useFeedStore.getState().lists[HOME_FEED]?.error) announce(tr('已刷新', 'Refreshed'));
    },
  });

  const goBack = useCallback(() => {
    if (canGoBack(location)) navigate(-1);
    else navigate('/discover', { replace: true });
  }, [location, navigate]);

  const openComposer = useCallback((start: ComposerStart, inGesture: boolean) => {
    barRef.current.close();
    // Text only: the composer focuses its textarea while mounting, which must happen inside this tap for the
    // iPhone keyboard to rise, so the update is applied synchronously.
    // 只发文字：编辑器挂载时聚焦输入框，必须在这次点按之内完成，iPhone 的键盘才会弹出，因此同步应用这次更新。
    if (inGesture) flushSync(() => setComposer(start));
    else setComposer(start);
  }, []);

  const openTextComposer = useCallback(() => openComposer({ kind: 'text' }, true), [openComposer]);
  const openSheet = useCallback(() => setSheet(true), []);
  const closeSheet = useCallback(() => setSheet(false), []);
  const closeComposer = useCallback(() => setComposer(null), []);
  const published = useCallback(() => {
    useFeedStore.getState().saveScroll(HOME_FEED, 0);
    setComposer(null);
  }, []);

  const onPicked = useCallback((files: File[]) => openComposer({ kind: 'files', files }, false), [openComposer]);

  const openMedia = useCallback((request: MediaOpenRequest) => {
    const view = viewsRef.current.find((item) => item.post.id === request.postId);
    const media = view?.post.media[request.index];
    if (!view || !media) return;
    barRef.current.close();
    // Playback starts inside this tap, so the sound plays on iPhone; the player that mounts next takes it over.
    // 在这次点按之内开始播放，iPhone 上才有声音；随后挂载的播放器接管它。
    if (media.kind === 'video') primeMomentVideo(media, view.localMedia?.[request.index] ?? null, tokenRef.current);
    setOpened({ postId: request.postId, index: request.index, rect: request.rect, kind: media.kind });
  }, []);

  const closeMedia = useCallback(() => setOpened(null), []);

  const commentFromViewer = useCallback((view: MomentView, index: number) => {
    if (!view.post.canInteract) return;
    // The viewer goes first, so its cleanup cannot take focus back from the bar that opens next in this tap.
    // 先关闭查看器，它的清理才不会把焦点从随后在这次点按中打开的评论栏上拿走。
    flushSync(() => setOpened(null));
    barRef.current.open({
      postId: view.post.id,
      clubWide: view.post.clubWide,
      replyTo: null,
      anchor: () => findMediaCell(view.post.id, index)?.closest('article') ?? null,
    });
  }, []);

  const showIncoming = useCallback(() => {
    void scrollPageToTop().then((reached) => {
      if (reached) useFeedStore.getState().mergeIncoming();
    });
  }, []);

  const toTop = useCallback(() => {
    void scrollPageToTop();
  }, []);

  const retry = useCallback(() => {
    void useFeedStore.getState().refresh(HOME_FEED);
  }, []);

  const loadMore = useCallback(() => {
    void useFeedStore.getState().loadMore(HOME_FEED);
  }, []);

  const person = useMemo<MomentAlbumOwner | null>(
    () =>
      member
        ? { id: member.id, displayName: member.displayName, avatarKey: member.avatarKey, coverKey: member.coverKey, headline: member.headline }
        : null,
    [member],
  );
  const memberId = member?.id ?? null;
  const openOwnAlbum = useCallback(() => {
    if (memberId) navigate(`/discover/feed/member/${encodeURIComponent(memberId)}`);
  }, [memberId, navigate]);

  const showBanner = hasContent && (!online || (list.status === 'ready' && list.error !== null && !list.refreshing));

  return (
    <div ref={rootRef} className="min-h-[100dvh] bg-wx-canvas" style={ROOT}>
      <MomentsHeader
        ref={headerRef}
        hidden={composing}
        title={tr('好友动态', 'Friend updates')}
        backLabel={tr('发现', 'Discover')}
        onBack={goBack}
        onTitleClick={toTop}
        trailing={<CameraButton onOpenSheet={openSheet} onTextOnly={openTextComposer} />}
      />
      <PullIndicator refreshing={refreshing} hidden={composing} />
      <NewPostsPill count={list.incoming.length} visible={pastCover && !composing} onActivate={showIncoming} />

      <main ref={contentRef} hidden={composing} className="mx-auto max-w-2xl bg-white" style={COLUMN}>
        {person ? <MomentsCover person={person} editable onAvatarClick={openOwnAlbum} /> : <div className="h-48 bg-brand-800" />}
        <NoticeBubble />
        {showBanner ? <OfflineBanner offline={!online} error={list.error} onRetry={retry} /> : null}
        {loading ? <FeedSkeleton /> : null}
        {list.status === 'error' && !hasContent ? <FeedError message={list.error} onRetry={retry} /> : null}
        {empty && friendCount !== null ? (
          <FeedEmpty noFriends={friendCount === 0} onOpenContacts={() => navigate('/chat?tab=members')} onPost={openSheet} />
        ) : null}
        {hasContent ? (
          <div role="feed" aria-busy={list.refreshing || list.more === 'loading'} aria-label={tr('好友动态', 'Friend updates')}>
            {views.map((view) => (
              <MomentItem key={view.key} view={view} feed={HOME_FEED} onOpenMedia={openMedia} />
            ))}
          </div>
        ) : null}
        {list.status === 'ready' && hasContent ? (
          <ListFooter more={list.more} hasMore={list.nextCursor !== null && !list.fromCache} hasItems={hasContent} onLoadMore={loadMore} />
        ) : null}
        {/* Room for the comment bar and the keyboard while open, so the last post can rise above them. */}
        {/* 评论栏打开时为它和键盘留出空间，最后一条动态才能升到它们上方。 */}
        <div aria-hidden style={{ height: `calc(${bar.inset}px + var(--safe-bottom))` }} />
      </main>

      {composer ? <MomentComposer start={composer} onClose={closeComposer} onPublished={published} /> : null}
      <MediaPicker ref={pickerRef} onPicked={onPicked} />
      {sheet ? <PostSheet picker={pickerRef} onTextOnly={openTextComposer} onClose={closeSheet} /> : null}
      {opened ? <OpenedMediaLayer opened={opened} mediaToken={mediaToken} onClose={closeMedia} onComment={commentFromViewer} /> : null}
      <CommentBarHost headerHeight={HEADER_HEIGHT} />
      <MomentsLiveRegion />
    </div>
  );
}
