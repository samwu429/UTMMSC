import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { useLocation, useNavigate, useNavigationType, useParams, useSearchParams, type Location } from 'react-router-dom';
import { MOMENT_MODERATION_REASON_MAX, momentTextLength } from '@utmmsc/shared';
import { useTr } from '../../../shared/i18n/locale';
import { useSessionStore } from '../../../shared/session/store';
import { ActionSheet, type ActionSheetOption } from '../../../shared/ui/ActionSheet';
import { useBackToClose } from '../../../shared/ui/overlayHistory';
import { useStatusBarColor } from '../../../shared/ui/useStatusBarColor';
import { WX_COLORS } from '../../../shared/ui/wxTokens';
import { WxSpinner } from '../../../shared/ui/WxSpinner';
import { OVERLAY_BOTTOM_INSET, useVisualViewportOverlay } from '../../chat/room/useVisualViewport';
import { MomentsLiveRegion } from '../announce';
import { CommentBarHost } from '../comment/CommentBarHost';
import { useCommentBar, type CommentBarController } from '../comment/useCommentBar';
import { FeedError } from '../components/FeedStates';
import { MomentItem } from '../components/MomentItem';
import { MomentsHeader } from '../components/MomentsHeader';
import { ReportSheet } from '../components/ReportSheet';
import { useScrollRestore } from '../hooks/useScrollRestore';
import { MoreIcon } from '../icons';
import { HEADER_HEIGHT } from '../layout/pull';
import { postFeedKey, type MediaOpenRequest, type MomentView } from '../model';
import { REOPEN_REFRESH_MS, useFeedList, useFeedStore, useMomentView, usePinnedLocalMedia } from '../state/feedStore';
import { MomentImageViewer } from '../viewer/MomentImageViewer';
import { primeMomentVideo, VideoPlayer } from '../viewer/VideoPlayer';

/* Links between the moments pages */
/* 好友动态各页面之间的链接 */

/**
 * Router state of a link into the detail page or 动态设置, naming the page it came from, so the back control
 * can say where it returns. A push or a typed address carries none.
 * 进入详情页或「动态设置」的链接所带的路由状态，写明来自哪个页面，返回按钮因此能说明返回到哪里。推送或手动输入的地址不带这个状态。
 */
export interface MomentDetailLinkState {
  from: 'album' | 'notices' | 'reports';
}

/** /discover/feed/post/:postId, with ?comment= to flash one comment. */
/** /discover/feed/post/:postId；带 ?comment= 时闪烁对应的评论。 */
export function momentDetailPath(postId: string, commentId?: string | null): string {
  const path = `/discover/feed/post/${encodeURIComponent(postId)}`;
  return commentId ? `${path}?comment=${encodeURIComponent(commentId)}` : path;
}

/** True when there is an in-app page to return to, rather than a page opened straight from a link or a push. */
/** 存在可返回的站内页面时为 true，而不是直接从链接或推送打开的页面。 */
function canGoBack(location: Location): boolean {
  if (location.key === 'default') return false;
  const index = (window.history.state as { idx?: unknown } | null)?.idx;
  return typeof index !== 'number' || index > 0;
}

/**
 * Back for a moments page: the previous page when there is one, so the list underneath comes back at the same
 * place, otherwise `fallback` in place of this page.
 * 好友动态页面的返回：有上一页时回到上一页，下面的列表回到原来的位置；否则用 `fallback` 替换当前页面。
 */
export function useMomentsBack(fallback: string): () => void {
  const navigate = useNavigate();
  const location = useLocation();
  return useCallback(() => {
    if (canGoBack(location)) navigate(-1);
    else navigate(fallback, { replace: true });
  }, [fallback, location, navigate]);
}

/** Where a link said it came from, or null for a push, a typed address or anything else. */
/** 链接所说明的来源；推送、手动输入的地址或其他情况为 null。 */
export function readLinkState(state: unknown): MomentDetailLinkState['from'] | null {
  const from = (state as Partial<MomentDetailLinkState> | null)?.from;
  return from === 'album' || from === 'notices' || from === 'reports' ? from : null;
}

/**
 * Leaves the page once the sheet that was just closed has taken its own history entry off. Going back in the
 * same task would only remove that entry and the page would stay, so this waits for its popstate; a sheet whose
 * entry was never pushed pops nothing, which the timer covers.
 * 等刚关闭的菜单撤掉它自己的历史记录之后再离开页面。在同一任务中返回只会撤掉那条记录，页面仍会留下，因此这里等待它的 popstate；
 * 从未压入记录的菜单不会触发返回，由定时器兜底。
 */
function backAfterSheet(goBack: () => void): void {
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    window.removeEventListener('popstate', onPop);
    clearTimeout(timer);
    goBack();
  };
  // The overlay history handles the same popstate first, so the next step waits one task.
  // 浮层历史记录先处理同一个 popstate，因此下一步等待一个任务。
  const onPop = () => {
    setTimeout(finish, 0);
  };
  window.addEventListener('popstate', onPop);
  const timer = setTimeout(finish, 600);
}

/* Removal by a moderator */
/* 管理员移除 */

/** Quick reasons offered above the text field; the author reads the reason in 这条动态已被管理员移除：{reason}. */
/** 输入框上方提供的快捷原因；作者会在「这条动态已被管理员移除：{原因}」中看到它。 */
const QUICK_REASONS: [string, string][] = [
  ['垃圾广告', 'Spam'],
  ['骚扰或攻击', 'Harassment'],
  ['不当内容', 'Inappropriate'],
  ['泄露隐私', 'Privacy'],
];

/**
 * The reason a moderator gives for 删除（管理员）. It is pinned to the visible part of the screen, so the field and
 * its buttons stay above the keyboard. Resolves to true once removed; on false it stays open to try again.
 * 管理员「删除（管理员）」时填写的原因。浮层固定在屏幕的可见区域内，输入框和按钮始终在键盘上方。移除成功时为 true；为 false 时保持打开，可以再试。
 */
function RemovalReasonSheet({ onClose, onSubmit }: { onClose(): void; onSubmit(reason: string): Promise<boolean> }) {
  const tr = useTr();
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const hintId = useId();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const pressStartedOnBackdrop = useRef(false);
  const length = momentTextLength(reason.trim());
  const valid = length > 0 && length <= MOMENT_MODERATION_REASON_MAX;

  useVisualViewportOverlay(rootRef);
  useBackToClose(onClose);

  useLayoutEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    const done = await onSubmit(reason.trim());
    if (!done) setBusy(false);
  }

  return createPortal(
    <div
      ref={rootRef}
      className="wx-fade z-[60] flex flex-col justify-end bg-black/40"
      onPointerDown={(event) => {
        pressStartedOnBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && pressStartedOnBackdrop.current && !busy) onClose();
        pressStartedOnBackdrop.current = false;
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={hintId}
        tabIndex={-1}
        className="wx-slide-up mx-auto max-h-full w-full max-w-2xl overflow-y-auto overscroll-contain rounded-t-xl bg-white px-4 pt-4 outline-none"
        style={{ paddingBottom: `calc(16px + ${OVERLAY_BOTTOM_INSET})`, paddingLeft: 'max(16px, var(--safe-left))', paddingRight: 'max(16px, var(--safe-right))' }}
      >
        <h2 id={titleId} className="text-center text-[17px] font-semibold text-wx-ink">
          {tr('删除（管理员）', 'Remove as admin')}
        </h2>
        <p id={hintId} className="mt-1 text-center text-[13px] leading-5 text-wx-meta">
          {tr('作者会收到通知，并看到你填写的原因', 'The author is told and sees the reason you give')}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {QUICK_REASONS.map(([zh, en]) => {
            const label = tr(zh, en);
            const chosen = reason.trim() === label;
            return (
              <button
                key={zh}
                type="button"
                aria-pressed={chosen}
                onClick={() => setReason(label)}
                className={`min-h-9 rounded-full border-[0.5px] px-3 text-[14px] active:bg-wx-pressed ${chosen ? 'border-brand-700 bg-brand-50 text-brand-800' : 'border-wx-line bg-wx-bar text-wx-ink'}`}
              >
                {label}
              </button>
            );
          })}
        </div>
        <label className="mt-3 block">
          <span className="sr-only">{tr('移除原因', 'Reason for removal')}</span>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            maxLength={MOMENT_MODERATION_REASON_MAX * 2}
            placeholder={tr('移除原因', 'Reason for removal')}
            className="block w-full resize-none rounded-md bg-wx-bar px-3 py-2 text-[16px] leading-6 text-wx-ink outline-none placeholder:text-wx-meta focus-visible:ring-2 focus-visible:ring-brand-100"
          />
        </label>
        <p className={`mt-1 text-right text-[12px] ${length > MOMENT_MODERATION_REASON_MAX ? 'text-wx-red' : 'text-wx-meta'}`} aria-live="polite">
          {length > MOMENT_MODERATION_REASON_MAX ? tr(`原因不能超过 ${MOMENT_MODERATION_REASON_MAX} 字`, `Keep the reason under ${MOMENT_MODERATION_REASON_MAX + 1} characters`) : `${length}/${MOMENT_MODERATION_REASON_MAX}`}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="min-h-11 rounded-lg bg-wx-bar text-[16px] text-wx-ink active:bg-wx-pressed disabled:opacity-50">
            {tr('取消', 'Cancel')}
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!valid || busy}
            className="flex min-h-11 items-center justify-center gap-2 rounded-lg bg-wx-red text-[16px] font-medium text-white active:opacity-80 disabled:opacity-40"
          >
            {busy ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" /> : null}
            {tr('移除', 'Remove')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* The page */
/* 页面 */

type Sheet = 'actions' | 'delete' | 'report' | 'moderate';

const ROOT: CSSProperties = {
  paddingTop: `calc(var(--safe-top) + ${HEADER_HEIGHT}px)`,
  paddingLeft: 'var(--safe-left)',
  paddingRight: 'var(--safe-right)',
};

const COLUMN: CSSProperties = { minHeight: `calc(100dvh - var(--safe-top) - ${HEADER_HEIGHT}px)` };

function DetailScreen({ postId }: { postId: string }) {
  const tr = useTr();
  const location = useLocation();
  const navigationType = useNavigationType();
  const [params] = useSearchParams();
  const flashCommentId = params.get('comment');
  const key = postFeedKey(postId);
  const list = useFeedList(key);
  const view = useMomentView(postId);
  const sessionToken = useSessionStore((s) => s.mediaToken);
  const feedToken = useFeedStore((s) => s.mediaToken);
  const mediaToken = feedToken ?? sessionToken;
  const bar = useCommentBar();
  const goBack = useMomentsBack('/discover/feed');
  const [freshVisit] = useState(() => navigationType !== 'POP');
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [media, setMedia] = useState<{ index: number; rect: DOMRect | null } | null>(null);
  // Set once the post was deleted or removed here, so the page leaves without flashing 这条动态已删除或无法查看.
  // 在本页删除或移除这条动态后设置，页面离开时不会闪现「这条动态已删除或无法查看」。
  const [leaving, setLeaving] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<MomentView | null>(view);
  const tokenRef = useRef(mediaToken);
  const barRef = useRef<CommentBarController>(bar);
  useLayoutEffect(() => {
    viewRef.current = view;
    tokenRef.current = mediaToken;
    barRef.current = bar;
  });
  useStatusBarColor(WX_COLORS.canvas);

  // A fresh visit opens at the top (the flashed comment then scrolls itself into view); a back navigation keeps
  // the place. Declared before useScrollRestore, so its restore reads the place set here.
  // 重新进入时从顶部打开（要闪烁的评论随后自己滚动到可见处）；后退导航保留原来的位置。写在 useScrollRestore 之前，它恢复时读到的是这里设置的位置。
  useLayoutEffect(() => {
    if (freshVisit) useFeedStore.getState().saveScroll(key, 0);
  }, [freshVisit, key]);

  useScrollRestore(key, { ready: view !== null });

  // The store opens the post with its first 200 comments and then follows the cursor page by page by itself.
  // Whether that open fetches page 1 is noted for the check below: a list missing, not ready, or older than
  // REOPEN_REFRESH_MS is fetched, and that fetch brings the whole thread anyway.
  // store 打开这条动态时带上前 200 条评论，然后自己逐页跟随游标加载其余评论。这次打开是否会请求第一页会记下来供下面的检查使用：
  // 列表不存在、尚未就绪或已超过 REOPEN_REFRESH_MS 时会请求，而那次请求本来就会带回完整的评论。
  const openFetchedRef = useRef(false);
  useEffect(() => {
    const before = useFeedStore.getState().lists[key];
    openFetchedRef.current = !before || before.status !== 'ready' || before.loadedAt === null || Date.now() - before.loadedAt >= REOPEN_REFRESH_MS;
    useFeedStore.getState().open(key);
  }, [key]);

  // A link that names a comment this copy lacks (a push or a notice for a comment that arrived after the copy
  // was loaded, with this post already open or loaded recently) loads page 1 again, so the comment appears and
  // flashes. Keyed on location.key, every navigation carrying ?comment= checks again; the visit's first check
  // is skipped when the open above fetches by itself. A thread still paging, or one with comments still to
  // load, brings the comment on its own.
  // 链接指向的评论不在当前副本中时（副本加载之后才到达的评论的推送或消息，而这条动态已经打开或刚加载过），重新加载第一页，
  // 这条评论才会出现并闪烁。以 location.key 为依赖，每次带 ?comment= 的导航都会再检查一次；如果上面的打开本身已经会请求，
  // 本次访问的第一次检查跳过。评论仍在分页加载，或还有未加载的评论时，它会自己带回这条评论。
  useEffect(() => {
    const fetched = openFetchedRef.current;
    openFetchedRef.current = false;
    if (!flashCommentId || fetched) return;
    const current = viewRef.current;
    if (!current || current.local || current.commentPaging === 'loading' || current.moreComments > 0) return;
    if (current.comments.some((item) => item.type === 'server' && item.comment.id === flashCommentId)) return;
    void useFeedStore.getState().refresh(key);
  }, [flashCommentId, key, location.key]);

  const openMedia = useCallback((request: MediaOpenRequest) => {
    const current = viewRef.current;
    const item = current?.post.media[request.index];
    if (!current || !item) return;
    barRef.current.close();
    // Playback starts inside this tap, so the sound plays on iPhone; the player that mounts next takes it over.
    // 在这次点击中开始播放，iPhone 上才能播放声音；随后挂载的播放器接管它。
    if (item.kind === 'video') primeMomentVideo(item, current.localMedia?.[request.index] ?? null, tokenRef.current);
    setMedia({ index: request.index, rect: request.rect });
  }, []);

  const closeMedia = useCallback(() => setMedia(null), []);
  // While a player or viewer is open, this device's copy of a post still sending stays usable even after the server confirms it.
  // 播放器或查看器打开期间，仍在发送的动态在本设备上的媒体副本保持可用，即使服务器已经确认。
  usePinnedLocalMedia(media ? postId : null);

  const commentFromViewer = useCallback(() => {
    const current = viewRef.current;
    if (!current?.post.canInteract) return;
    // The viewer goes first, so its cleanup cannot take focus back from the bar that opens next in this tap.
    // 先关闭查看器，它的清理才不会把焦点从随后在这次点按中打开的评论栏上拿走。
    flushSync(() => setMedia(null));
    barRef.current.open({ postId: current.post.id, clubWide: current.post.clubWide, replyTo: null, anchor: () => cardRef.current });
  }, []);

  function deleteOwn() {
    setLeaving(true);
    backAfterSheet(goBack);
    // The store takes the post off every list at once, says 已删除, and puts it back with a toast if the server refuses.
    // store 会立即从所有列表中拿掉这条动态并播报「已删除」；服务器拒绝时放回原处并提示。
    void useFeedStore.getState().deletePost(postId);
  }

  async function removeWithReason(reason: string): Promise<boolean> {
    // A refusal is already told by the store's toast; the sheet stays open to try again.
    // 失败时 store 已经给出提示；菜单保持打开，可以再试。
    const ok = await useFeedStore.getState().removeAsModerator({ postId }, reason);
    if (!ok) return false;
    setSheet(null);
    setLeaving(true);
    backAfterSheet(goBack);
    return true;
  }

  const post = view?.post ?? null;
  const actions: ActionSheetOption[] = [];
  if (post && !view?.local) {
    if (post.canReport) actions.push({ label: tr('投诉', 'Report'), onSelect: () => setSheet('report') });
    if (post.canDelete) actions.push({ label: tr('删除', 'Delete'), danger: true, onSelect: () => setSheet('delete') });
    if (post.canModerate) actions.push({ label: tr('删除（管理员）', 'Remove as admin'), danger: true, onSelect: () => setSheet('moderate') });
  }

  const from = readLinkState(location.state);
  const backLabel = from === 'notices' ? tr('消息', 'Notifications') : from === 'album' ? tr('相册', 'Album') : from === 'reports' ? tr('管理', 'Admin') : tr('好友动态', 'Updates');
  // A post that left every list (deleted elsewhere, or a 404 on an action) is gone from here too.
  // 已从所有列表中移除的动态（在别处删除，或某个操作返回 404）在这里也视为不存在。
  const unavailable = !view && (list.status === 'unavailable' || (list.status === 'ready' && !list.refreshing));
  const opened = media && view ? (view.post.media[media.index] ?? null) : null;
  const commentPaging = view?.commentPaging ?? 'idle';

  let body;
  if (leaving) {
    body = null;
  } else if (view) {
    body = (
      <>
        <div ref={cardRef}>
          <MomentItem view={view} feed={key} variant="detail" flashCommentId={flashCommentId} onOpenMedia={openMedia} />
        </div>
        {commentPaging === 'loading' ? (
          <div className="flex min-h-11 items-center justify-center pb-4">
            <WxSpinner size={16} />
          </div>
        ) : commentPaging === 'failed' ? (
          <div className="flex justify-center pb-4">
            {/* Page 1 again, after which the store follows the cursor once more. */}
            {/* 重新加载第一页，之后 store 会再次跟随游标加载。 */}
            <button type="button" onClick={() => void useFeedStore.getState().refresh(key)} className="min-h-11 px-3 text-[14px] text-wx-link active:opacity-60">
              {tr('加载失败，轻触重试', "Couldn't load. Tap to retry")}
            </button>
          </div>
        ) : null}
      </>
    );
  } else if (unavailable) {
    body = (
      <div className="flex flex-col items-center px-8 pb-16 pt-14 text-center">
        <p className="text-[15px] leading-6 text-wx-meta">{tr('这条动态已删除或无法查看', "This update was deleted or isn't available")}</p>
        <button type="button" onClick={goBack} className="mt-3 min-h-11 rounded-[4px] bg-wx-bar px-5 text-[15px] font-medium text-wx-link active:bg-wx-pressed">
          {tr('返回', 'Go back')}
        </button>
      </div>
    );
  } else if (list.status === 'error') {
    body = <FeedError message={list.error} onRetry={() => void useFeedStore.getState().refresh(key)} />;
  } else {
    body = (
      <div className="flex justify-center py-16">
        <WxSpinner />
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-wx-canvas" style={ROOT}>
      <MomentsHeader
        variant="solid"
        title={tr('详情', 'Details')}
        backLabel={backLabel}
        onBack={goBack}
        trailing={
          actions.length > 0 && !leaving ? (
            <button
              type="button"
              onClick={() => setSheet('actions')}
              aria-label={tr('更多操作', 'More actions')}
              aria-haspopup="dialog"
              className="flex h-11 w-11 items-center justify-center active:opacity-60"
            >
              <MoreIcon />
            </button>
          ) : null
        }
      />
      <main className="mx-auto max-w-2xl bg-white" style={COLUMN}>
        {body}
        {/* Room for the comment bar and the keyboard while open, so the end of the post can rise above them. */}
        {/* 评论栏打开时为它和键盘留出空间，动态的末尾才能升到它们上方。 */}
        <div aria-hidden style={{ height: `calc(${bar.inset}px + var(--safe-bottom))` }} />
      </main>

      <CommentBarHost headerHeight={HEADER_HEIGHT} />
      <MomentsLiveRegion />

      {sheet === 'actions' ? <ActionSheet options={actions} onClose={() => setSheet(null)} /> : null}
      {sheet === 'delete' ? (
        <ActionSheet
          title={tr('删除这条动态？', 'Delete this update?')}
          options={[{ label: tr('删除', 'Delete'), danger: true, onSelect: deleteOwn }]}
          onClose={() => setSheet(null)}
        />
      ) : null}
      {sheet === 'report' ? <ReportSheet postId={postId} onClose={() => setSheet(null)} /> : null}
      {sheet === 'moderate' ? <RemovalReasonSheet onClose={() => setSheet(null)} onSubmit={removeWithReason} /> : null}

      {view && media && opened?.kind === 'video' ? (
        <VideoPlayer media={opened} localMedia={view.localMedia?.[media.index] ?? null} mediaToken={mediaToken} startRect={media.rect} onClose={closeMedia} />
      ) : null}
      {view && media && opened?.kind === 'image' ? (
        <MomentImageViewer
          view={view}
          startIndex={media.index}
          startRect={media.rect}
          mediaToken={mediaToken}
          onClose={closeMedia}
          onLike={() => useFeedStore.getState().toggleLike(view.post.id)}
          onComment={commentFromViewer}
        />
      ) : null}
    </div>
  );
}

/**
 * /discover/feed/post/:postId?comment=<id>: one MomentItem with its text open and every comment (the cursor is followed automatically), the header ··· sheet, and 这条动态已删除或无法查看 when it is gone. A notice or a push opens it and the comment flashes.
 * /discover/feed/post/:postId?comment=<id>：一条正文展开、显示全部评论的 MomentItem（自动跟随游标加载），顶栏「···」菜单；动态已不存在时显示「这条动态已删除或无法查看」。从消息或推送打开，并闪烁对应的评论。
 */
export function MomentDetailPage() {
  const { postId = '' } = useParams();
  // Keyed by post, so nothing carries over from one post to the next.
  // 按动态区分实例，不同动态之间不会带入任何状态。
  return <DetailScreen key={postId} postId={postId} />;
}
