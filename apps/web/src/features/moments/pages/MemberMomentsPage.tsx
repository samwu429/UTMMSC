import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { flushSync } from 'react-dom';
import { useNavigate, useNavigationType, useParams } from 'react-router-dom';
import type { MomentAlbumOwner } from '@utmmsc/shared';
import { useTr } from '../../../shared/i18n/locale';
import { useSessionStore } from '../../../shared/session/store';
import { ActionSheet, type ActionSheetOption } from '../../../shared/ui/ActionSheet';
import { useStatusBarColor } from '../../../shared/ui/useStatusBarColor';
import { WX_COLORS } from '../../../shared/ui/wxTokens';
import { MomentsLiveRegion } from '../announce';
import { AlbumTimeline } from '../components/AlbumTimeline';
import { PostSheet } from '../components/CameraButton';
import { FeedError, ListFooter } from '../components/FeedStates';
import { MomentsCover } from '../components/MomentsCover';
import { MomentsHeader } from '../components/MomentsHeader';
import { MediaPicker, type MediaPickerHandle } from '../composer/MediaPicker';
import { MomentComposer, type ComposerStart } from '../composer/MomentComposer';
import { useHeaderProgress } from '../hooks/useHeaderProgress';
import { useScrollRestore } from '../hooks/useScrollRestore';
import { MoreIcon } from '../icons';
import { COVER_HEIGHT } from '../layout/pull';
import { albumFeedKey, type MomentView } from '../model';
import { useFeedList, useFeedStore, useMomentViews } from '../state/feedStore';
import { useMomentsBack, type MomentDetailLinkState } from './MomentDetailPage';

const ROOT: CSSProperties = {
  paddingTop: 'var(--safe-top)',
  paddingLeft: 'var(--safe-left)',
  paddingRight: 'var(--safe-right)',
};

const COLUMN: CSSProperties = { minHeight: 'calc(100dvh - var(--safe-top))' };

const SETTINGS_LINK: MomentDetailLinkState = { from: 'album' };

/** The cover's place while the owner is not known yet, so nothing jumps when it arrives. */
/** 尚不知道相册主人时封面的占位，信息到达时页面不会跳动。 */
function CoverPlaceholder() {
  return (
    <div aria-hidden>
      <div className="bg-brand-800" style={{ height: COVER_HEIGHT }} />
      <div className="h-11 bg-white" />
    </div>
  );
}

/** Three timeline rows while page 1 loads. */
/** 第一页加载时显示的三行时间线占位。 */
function TimelineSkeleton() {
  const tr = useTr();
  return (
    <div role="status" aria-label={tr('加载中', 'Loading')} className="space-y-6 px-4 pt-5 motion-safe:animate-pulse">
      {[0, 1, 2].map((row) => (
        <div key={row} aria-hidden className="flex">
          <div className="w-[84px] shrink-0">
            <div className="h-6 w-8 rounded-sm bg-wx-bar" />
          </div>
          <div className="flex flex-1 gap-2">
            <div className="h-[76px] w-[76px] shrink-0 bg-wx-bar" />
            <div className="flex-1 space-y-2 py-1">
              <div className="h-3.5 w-4/5 rounded-sm bg-wx-bar" />
              <div className="h-3.5 w-1/2 rounded-sm bg-wx-bar" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

type Sheet = 'post' | 'more' | { failed: MomentView };

function AlbumScreen({ memberId }: { memberId: string }) {
  const tr = useTr();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const me = useSessionStore((s) => s.member);
  const sessionToken = useSessionStore((s) => s.mediaToken);
  const feedToken = useFeedStore((s) => s.mediaToken);
  const own = me?.id === memberId;
  const key = albumFeedKey(memberId);
  const list = useFeedList(key);
  const views = useMomentViews(key);
  const mediaToken = feedToken ?? sessionToken;
  const goBack = useMomentsBack('/discover/feed');
  const [freshVisit] = useState(() => navigationType !== 'POP');
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [composer, setComposer] = useState<ComposerStart | null>(null);
  const headerRef = useRef<HTMLElement>(null);
  const pickerRef = useRef<MediaPickerHandle>(null);
  const composing = composer !== null;
  const hasViews = views.length > 0;
  const status = list.status;
  useStatusBarColor(WX_COLORS.canvas);

  // A fresh visit opens at the top; a back navigation comes back to the same place. Declared before
  // useScrollRestore, so its restore reads the place set here.
  // 重新进入时从顶部打开；后退导航回到原来的位置。写在 useScrollRestore 之前，它恢复时读到的是这里设置的位置。
  useLayoutEffect(() => {
    if (freshVisit) useFeedStore.getState().saveScroll(key, 0);
  }, [freshVisit, key]);

  useScrollRestore(key, { ready: hasViews || status === 'ready', paused: composing });
  useHeaderProgress(headerRef);

  useEffect(() => {
    useFeedStore.getState().open(key);
  }, [key]);

  // The composer starts at the top of the page; closing it restores the album's place (useScrollRestore).
  // 编辑器从页面顶部开始；关闭后恢复相册原来的位置（useScrollRestore）。
  useLayoutEffect(() => {
    if (composing) window.scrollTo(0, 0);
  }, [composing]);

  const openComposer = useCallback((start: ComposerStart, inGesture: boolean) => {
    // Text only: the composer focuses its textarea while mounting, which must happen inside this tap for the
    // iPhone keyboard to rise, so the update is applied synchronously.
    // 只发文字：编辑器挂载时聚焦输入框，必须在这次点按之内完成，iPhone 的键盘才会弹出，因此同步应用这次更新。
    if (inGesture) flushSync(() => setComposer(start));
    else setComposer(start);
  }, []);

  const openTextComposer = useCallback(() => openComposer({ kind: 'text' }, true), [openComposer]);
  const closeComposer = useCallback(() => setComposer(null), []);
  const published = useCallback(() => {
    // The new post waits at the top of the own album.
    // 新动态出现在自己相册的顶部。
    useFeedStore.getState().saveScroll(key, 0);
    setComposer(null);
  }, [key]);
  const onPicked = useCallback((files: File[]) => openComposer({ kind: 'files', files }, false), [openComposer]);

  const onCamera = useCallback(
    (mode: 'sheet' | 'text') => {
      if (mode === 'text') openTextComposer();
      else setSheet('post');
    },
    [openTextComposer],
  );
  const onFailedPost = useCallback((view: MomentView) => setSheet({ failed: view }), []);
  const closeSheet = useCallback(() => setSheet(null), []);
  const loadMore = useCallback(() => {
    void useFeedStore.getState().loadMore(key);
  }, [key]);
  const retry = useCallback(() => {
    void useFeedStore.getState().refresh(key);
  }, [key]);

  // The own cover shows at once from the session, before the album answers.
  // 自己的封面直接取自会话，在相册返回之前就能显示。
  const sessionOwner = useMemo<MomentAlbumOwner | null>(
    () => (own && me ? { id: me.id, displayName: me.displayName, avatarKey: me.avatarKey, coverKey: me.coverKey, headline: me.headline } : null),
    [own, me],
  );
  const owner = list.owner ?? sessionOwner;

  let sheetOptions: ActionSheetOption[] | null = null;
  let sheetTitle: string | undefined;
  if (sheet === 'more') {
    sheetOptions = [{ label: tr('动态设置', 'Update settings'), onSelect: () => navigate('/discover/feed/settings', { state: SETTINGS_LINK }) }];
  } else if (sheet && sheet !== 'post') {
    const clientId = sheet.failed.local?.clientId;
    sheetTitle = sheet.failed.local?.failure ?? tr('发送失败', "Couldn't send");
    sheetOptions = clientId
      ? [
          { label: tr('重试', 'Retry'), onSelect: () => useFeedStore.getState().retryPost(clientId) },
          { label: tr('删除', 'Delete'), danger: true, onSelect: () => useFeedStore.getState().discardPost(clientId) },
        ]
      : [];
  }

  // The same words whether the album is empty or hidden from this viewer, so nobody learns they were hidden from.
  // 相册为空或对这位查看者隐藏时显示同样的文字，因此没有人会知道自己被屏蔽了。
  const nothingToShow = <p className="px-8 py-14 text-center text-[15px] leading-6 text-wx-meta">{tr('暂无可见的动态', 'No updates to show')}</p>;
  const hasMore = list.nextCursor !== null && !list.fromCache;
  const atEnd = status === 'ready' && hasViews && !hasMore && list.more === 'idle';

  let content;
  if (status === 'unavailable') {
    content = nothingToShow;
  } else if (hasViews || (own && status === 'ready')) {
    content = (
      <>
        <AlbumTimeline views={views} mediaToken={mediaToken} own={own} onCamera={own ? onCamera : undefined} onFailedPost={onFailedPost} />
        {atEnd && list.clubOnly ? <p className="px-4 pt-6 text-center text-[13px] leading-5 text-wx-meta">{tr('只显示对全社团公开的动态', 'Showing club-wide updates only')}</p> : null}
        {status === 'ready' ? <ListFooter more={list.more} hasMore={hasMore} hasItems={hasViews} onLoadMore={loadMore} /> : null}
      </>
    );
  } else if (status === 'ready') {
    content = nothingToShow;
  } else if (status === 'error') {
    content = <FeedError message={list.error} onRetry={retry} />;
  } else {
    // The own album shows 今天 and the camera at once; the posts follow.
    // 自己的相册立即显示「今天」和相机，动态随后出现。
    content = (
      <>
        {own ? <AlbumTimeline views={views} mediaToken={mediaToken} own onCamera={onCamera} onFailedPost={onFailedPost} /> : null}
        <TimelineSkeleton />
      </>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-wx-canvas" style={ROOT}>
      {/* The chevron alone, as in WeChat's album; the header then names the button plain 返回 (Back). */}
      {/* 与微信相册一样只显示箭头；顶栏随之把按钮命名为「返回」（Back）。 */}
      <MomentsHeader
        ref={headerRef}
        hidden={composing}
        title={tr('相册', 'Album')}
        backLabel=""
        onBack={goBack}
        trailing={
          own ? (
            <button type="button" onClick={() => setSheet('more')} aria-label={tr('更多操作', 'More actions')} aria-haspopup="dialog" className="flex h-11 w-11 items-center justify-center active:opacity-60">
              <MoreIcon />
            </button>
          ) : null
        }
      />

      <main hidden={composing} className="mx-auto max-w-2xl bg-white pb-[max(24px,var(--safe-bottom))]" style={COLUMN}>
        {owner && status !== 'unavailable' ? <MomentsCover person={owner} editable={own} /> : <CoverPlaceholder />}
        {content}
      </main>

      {composer ? <MomentComposer start={composer} onClose={closeComposer} onPublished={published} /> : null}
      {own ? <MediaPicker ref={pickerRef} onPicked={onPicked} /> : null}
      {sheet === 'post' ? <PostSheet picker={pickerRef} onTextOnly={openTextComposer} onClose={closeSheet} /> : null}
      {sheetOptions ? <ActionSheet title={sheetTitle} options={sheetOptions} onClose={closeSheet} /> : null}
      <MomentsLiveRegion />
    </div>
  );
}

/**
 * /discover/feed/member/:memberId: the WeChat album timeline, grouped by local day under the member's cover; the own album starts with 今天 and a camera tile; 只显示对全社团公开的动态 when clubOnly.
 * /discover/feed/member/:memberId：微信式相册时间线，在成员封面下按本地日期分组；自己的相册以「今天」和相机格子开头；clubOnly 时显示「只显示对全社团公开的动态」。
 */
export function MemberMomentsPage() {
  const { memberId = '' } = useParams();
  // Keyed by member, so one album's place and sheets never carry over to the next.
  // 按成员区分实例，一个相册的位置和菜单不会带到下一个相册。
  return <AlbumScreen key={memberId} memberId={memberId} />;
}
