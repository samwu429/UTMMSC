import { memo, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useLocaleStore, useTr } from '../../../shared/i18n/locale';
import { useLongPress } from '../../../shared/ui/useLongPress';
import { mediaUrl } from '../../profile/media';
import { useOpenOnRelease } from '../hooks/useOpenOnRelease';
import { CameraIcon, LockIcon, PlayGlyph } from '../icons';
import type { MomentView } from '../model';
import { albumCountLabel, albumDayLabel, albumDaySpoken, albumThumb, albumYearLabel, groupAlbumDays, type AlbumDay, type AlbumThumb } from '../pages/album';
import { momentDetailPath, type MomentDetailLinkState } from '../pages/MomentDetailPage';

/**
 * The WeChat album timeline under a member's cover: one block per local day with the day written large on the
 * left (今天, 昨天, or 24 with 10月), and per post the first preview with 共N张 beside two lines of text, or the
 * text alone in a grey box. The own album starts with 今天 and the camera tile.
 * 成员封面下方的微信式相册时间线：每个本地日期一块，左侧用大字写日期（「今天」「昨天」，或「24」配「10月」）；每条动态显示第一张预览图和
 * 「共N张」，旁边是两行正文；没有媒体时正文单独放在灰色框里。自己的相册以「今天」和相机格子开头。
 */

const THUMB = 'relative block h-[76px] w-[76px] shrink-0 overflow-hidden';

export interface AlbumTimelineProps {
  /** The album's cards in display order: this device's unsent posts first on the own album, then the server's. */
  /** 相册中按显示顺序排列的卡片：自己的相册先显示本设备尚未发出的动态，再显示服务器的动态。 */
  views: readonly MomentView[];
  mediaToken: string | null;
  /** The signed-in member's own album: 今天 always comes first and holds the camera tile. */
  /** 当前成员自己的相册：总是以「今天」开头，并在其中放相机格子。 */
  own: boolean;
  /** The camera tile: a tap offers 拍照, 录像, 从相册选择 and 只发文字; a long press opens the text composer. */
  /** 相机格子：轻触提供「拍照」「录像」「从相册选择」「只发文字」；长按直接打开文字编辑器。 */
  onCamera?(mode: 'sheet' | 'text'): void;
  /** A local post that failed was tapped, for 重试 and 删除. */
  /** 轻触了发送失败的本地动态，用于「重试」和「删除」。 */
  onFailedPost?(view: MomentView): void;
}

function ThumbImage({ src, dark }: { src: string | null; dark: boolean }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  return (
    <span aria-hidden className={`${THUMB} ${dark ? 'bg-stone-800' : 'bg-wx-bar'}`}>
      {src && src !== failedSrc ? (
        <img src={src} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setFailedSrc(src)} className="h-full w-full object-cover [-webkit-touch-callout:none]" />
      ) : null}
      {dark ? (
        <span className="absolute inset-0 flex items-center justify-center">
          <PlayGlyph size={28} />
        </span>
      ) : null}
    </span>
  );
}

/** The image a row shows: this device's copy while the post is still being sent, otherwise the server's preview. */
/** 一行显示的图片：动态仍在发送时用本设备的副本，否则用服务器的预览图。 */
function thumbSource(view: MomentView, thumb: AlbumThumb, mediaToken: string | null): string | null {
  if (thumb.kind === 'text') return null;
  if (view.local) {
    const copy = view.localMedia?.[0] ?? null;
    if (!copy) return null;
    return copy.previewUrl ?? (copy.kind === 'image' ? copy.fileUrl : null);
  }
  return thumb.key && mediaToken ? mediaUrl(thumb.key, mediaToken) : null;
}

function StatusLine({ view }: { view: MomentView }) {
  const tr = useTr();
  const local = view.local;
  if (local) {
    if (local.status === 'failed') return <span className="text-wx-red">{tr('发送失败', "Couldn't send")}</span>;
    if (local.status === 'waiting') return <span>{tr('等待网络', 'Waiting for network')}</span>;
    return <span>{tr('发送中…', 'Sending…')}</span>;
  }
  if (view.post.removed) return <span className="text-wx-red">{tr('这条动态已被管理员移除', 'An admin removed this update')}</span>;
  if (view.post.audience === 'private') {
    return (
      <span className="inline-flex items-center gap-1">
        <LockIcon className="h-3 w-3" />
        {tr('仅自己可见', 'Only me')}
      </span>
    );
  }
  return null;
}

const AlbumEntry = memo(function AlbumEntry({ view, mediaToken, onFailedPost }: { view: MomentView; mediaToken: string | null; onFailedPost?(view: MomentView): void }) {
  const tr = useTr();
  const locale = useLocaleStore((s) => s.locale);
  const post = view.post;
  const thumb = albumThumb(post.media);
  const count = albumCountLabel(thumb, locale);
  const status = <StatusLine view={view} />;
  const hasStatus = Boolean(view.local || post.removed || post.audience === 'private');
  const body = post.body.trim();
  // A post with only media still needs words for a screen reader.
  // 只有媒体的动态也需要给读屏软件一段文字。
  const mediaName = thumb.kind === 'video' ? tr('视频', 'Video') : thumb.kind === 'image' && thumb.count === 1 ? tr('照片', 'Photo') : null;

  const content =
    thumb.kind === 'text' ? (
      <span className="block rounded-[2px] bg-wx-bar px-2 py-1.5">
        <span className="line-clamp-3 whitespace-pre-line text-[15px] leading-[22px] text-wx-ink [overflow-wrap:anywhere]">{body}</span>
        {hasStatus ? <span className="mt-0.5 block text-[12px] leading-[18px] text-wx-meta">{status}</span> : null}
      </span>
    ) : (
      <span className="flex gap-2">
        <ThumbImage src={thumbSource(view, thumb, mediaToken)} dark={thumb.kind === 'video'} />
        <span className="flex min-w-0 flex-1 flex-col py-0.5">
          {body ? <span className="line-clamp-2 whitespace-pre-line text-[15px] leading-[22px] text-wx-ink [overflow-wrap:anywhere]">{body}</span> : null}
          {!body && mediaName ? <span className="sr-only">{mediaName}</span> : null}
          {count ? <span className="mt-1 text-[12px] leading-[18px] text-wx-meta">{count}</span> : null}
          {hasStatus ? <span className="mt-1 text-[12px] leading-[18px] text-wx-meta">{status}</span> : null}
        </span>
      </span>
    );

  const rowClass = 'block w-full text-left active:bg-wx-pressed';
  if (view.local) {
    if (view.local.status === 'failed' && onFailedPost) {
      return (
        <button type="button" onClick={() => onFailedPost(view)} className={rowClass}>
          {content}
        </button>
      );
    }
    return <div className={view.local.status === 'failed' ? '' : 'opacity-60'}>{content}</div>;
  }
  const state: MomentDetailLinkState = { from: 'album' };
  return (
    <Link to={momentDetailPath(post.id)} state={state} className={`${rowClass} ${view.deleting ? 'opacity-0 transition-opacity duration-200 motion-reduce:transition-none' : ''}`}>
      {content}
    </Link>
  );
});

function CameraTile({ onCamera }: { onCamera(mode: 'sheet' | 'text'): void }) {
  const tr = useTr();
  // WeChat's gesture is kept: a long press on the camera writes text only. A held press opens the composer on
  // its release, as the header camera does, so the keyboard comes up on iPhone.
  // 保留微信的手势：长按相机直接发文字。与顶栏的相机一样，按住时在松开那一刻才打开编辑器，iPhone 上键盘才会弹出。
  const openOnRelease = useOpenOnRelease(() => onCamera('text'));
  const { handlers, pressed } = useLongPress({ onLongPress: (info) => (info.held ? openOnRelease() : onCamera('text')) });
  return (
    <button
      type="button"
      {...handlers}
      onClick={() => onCamera('sheet')}
      aria-label={tr('发一条', 'Post one')}
      className={`${THUMB} flex items-center justify-center text-wx-meta [-webkit-touch-callout:none] ${pressed ? 'bg-wx-pressed' : 'bg-wx-bar'}`}
    >
      <CameraIcon className="h-8 w-8" />
    </button>
  );
}

function DayBlock({ day, nowMs, children }: { day: AlbumDay<unknown>; nowMs: number; children: ReactNode }) {
  const locale = useLocaleStore((s) => s.locale);
  const label = albumDayLabel(day, locale);
  const spoken = albumDaySpoken(day, locale, nowMs);
  return (
    <section aria-label={spoken} className="pt-5">
      {day.yearHeading !== null ? <h2 className="px-4 pb-3 pt-3 text-[22px] font-semibold leading-7 text-wx-ink">{albumYearLabel(day.yearHeading, locale)}</h2> : null}
      <div className="flex px-4">
        <p aria-hidden className="w-[84px] shrink-0 pr-2 leading-none text-wx-ink">
          {/* Yesterday is a long word in English, so the relative labels are set smaller there to fit the column. */}
          {/* 英文的 Yesterday 较长，因此英文的相对日期用较小的字号，才能放进这一列。 */}
          <span className={`font-semibold leading-7 ${day.relative ? (locale === 'en' ? 'text-[17px]' : 'text-[22px]') : 'text-[26px]'}`}>{label.primary}</span>
          {label.secondary ? <span className="ml-0.5 text-[12px] font-medium">{label.secondary}</span> : null}
        </p>
        <ol className="min-w-0 flex-1 space-y-2.5">{children}</ol>
      </div>
    </section>
  );
}

/**
 * Today as the page sees it. It is read again whenever the page comes back to the foreground, so an album left
 * open overnight still says 今天 and 昨天 for the right days.
 * 页面所认为的「今天」。页面回到前台时重新读取，因此隔夜仍开着的相册也会把「今天」「昨天」标在正确的日期上。
 */
function useToday(): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') setNowMs(Date.now());
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);
  return nowMs;
}

export function AlbumTimeline({ views, mediaToken, own, onCamera, onFailedPost }: AlbumTimelineProps) {
  const nowMs = useToday();
  const days = useMemo(() => groupAlbumDays(views, (view) => view.post.createdAt, { nowMs, startWithToday: own }), [views, own, nowMs]);

  return (
    <div className="pb-2">
      {days.map((day, index) => (
        <DayBlock key={day.key} day={day} nowMs={nowMs}>
          {index === 0 && own && day.relative === 'today' && onCamera ? (
            <li>
              <CameraTile onCamera={onCamera} />
            </li>
          ) : null}
          {day.items.map((view) => (
            <li key={view.key}>
              <AlbumEntry view={view} mediaToken={mediaToken} onFailedPost={onFailedPost} />
            </li>
          ))}
        </DayBlock>
      ))}
    </div>
  );
}
