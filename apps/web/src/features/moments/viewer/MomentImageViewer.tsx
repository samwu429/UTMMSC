import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MomentMedia } from '@utmmsc/shared';
import { useTr } from '../../../shared/i18n/locale';
import { ImageViewer, type ViewerImage } from '../../chat/room/ImageViewer';
import { mediaUrl } from '../../profile/media';
import { CommentIcon, HeartIcon } from '../icons';
import { findMediaCell, type LocalMedia, type MomentView } from '../model';
import { usePinnedLocalMedia } from '../state/feedStore';

export interface MomentImageViewerProps {
  view: MomentView;
  startIndex: number;
  /** The tapped cell, for the zoom out of it; closing shrinks into findMediaCell(view.post.id, index). */
  /** 被点击的格子，用于从它放大；关闭时缩回 findMediaCell(view.post.id, index)。 */
  startRect: DOMRect | null;
  mediaToken: string | null;
  onClose(): void;
  /** Footer 赞: the same desired-state toggle as the card. */
  /** 底部「赞」：与卡片相同的按想要状态切换。 */
  onLike(): void;
  /** Footer 评论: the page closes the viewer and opens the comment bar for this post. */
  /** 底部「评论」：页面关闭查看器，并为这条动态打开评论栏。 */
  onComment(): void;
}

/** One photo of the post: its place in post.media, which the cells are numbered by, and what the viewer shows. */
/** 动态中的一张照片：它在 post.media 中的位置（格子按此编号），以及查看器显示的内容。 */
interface ViewerPhoto {
  image: ViewerImage;
  index: number;
  media: MomentMedia;
  local: LocalMedia | null;
}

/**
 * Viewer ids from the media keys, so a saved photo is named after its own key (utmmsc-<id>.jpg) instead of its
 * place in the post. Two keys that hash alike, or a local copy without a key yet, take the next free id.
 * 由媒体键生成查看器 id，保存的照片按自己的键命名（utmmsc-<id>.jpg），而不是按它在动态中的位置命名。两个键哈希相同，
 * 或本地副本还没有键时，取下一个未用的 id。
 */
function viewerId(key: string, index: number, taken: Set<number>): number {
  let hash = 0;
  for (let at = 0; at < key.length; at += 1) hash = (Math.imul(hash, 31) + key.charCodeAt(at)) >>> 0;
  let id = key ? hash % 2_000_000_000 : index;
  while (taken.has(id)) id += 1;
  taken.add(id);
  return id;
}

/**
 * The post's photos in the chat viewer: the preview at once, then the original; swipe between them; long press
 * for 保存图片; GIFs animate here.
 * 用聊天查看器显示这条动态的照片：先显示预览图，再换成原图；左右滑动切换；长按可「保存图片」；GIF 在这里播放动画。
 */
export function MomentImageViewer({ view, startIndex, startRect, mediaToken, onClose, onLike, onComment }: MomentImageViewerProps) {
  const tr = useTr();
  const postId = view.post.id;
  // The id it opened on: a post still sending keeps its local id here after the server's copy takes its place.
  // 打开时的 id：仍在发送的动态被服务器的副本替换之后，这里仍是它的本地 id。
  const [openedId] = useState(postId);
  // This device's copies stay while the viewer shows them (the detail page's viewer included).
  // 查看器显示本设备的副本期间保留它们（详情页的查看器也一样）。
  usePinnedLocalMedia(openedId);

  // Each photo keeps the id it first had for the viewer's lifetime. A post opened while it is still sending swaps
  // its local:<item> keys for the stored ones when the server confirms it, and a new id would make ImageViewer lose
  // the photo on screen and close.
  // 每张照片在查看器存在期间沿用它第一次得到的 id。仍在发送时打开的动态，在服务器确认后会把 local:<项目> 键换成保存的键，
  // 若 id 随之改变，ImageViewer 会找不到正在显示的照片而关闭。
  const idsRef = useRef(new Map<number, number>());

  const photos = useMemo<ViewerPhoto[]>(() => {
    const ids = idsRef.current;
    const taken = new Set<number>();
    view.post.media.forEach((media, index) => {
      const kept = ids.get(index);
      if (media.kind === 'image' && kept !== undefined) taken.add(kept);
    });
    return view.post.media.flatMap((media, index) => {
      if (media.kind !== 'image') return [];
      const local = view.localMedia?.[index] ?? null;
      let id = ids.get(index);
      if (id === undefined) {
        id = viewerId(media.key, index, taken);
        ids.set(index, id);
      }
      return [{ index, media, local, image: { id, imageKey: media.key, width: media.width, height: media.height } }];
    });
  }, [view.post.media, view.localMedia]);

  const byId = useMemo(() => new Map(photos.map((photo) => [photo.image.id, photo])), [photos]);
  const images = useMemo(() => photos.map((photo) => photo.image), [photos]);
  const start = photos.find((photo) => photo.index === startIndex) ?? photos[0];

  // This device's copy first (a post published from here), then the original, which also animates a GIF.
  // 先用本设备上的副本（从这里发表的动态），否则用原图；GIF 原图会播放动画。
  const srcFor = useCallback(
    (image: ViewerImage, token: string | null) => {
      const photo = byId.get(image.id);
      if (!photo) return null;
      if (photo.local?.fileUrl) return photo.local.fileUrl;
      return photo.media.key && token ? mediaUrl(photo.media.key, token) : null;
    },
    [byId],
  );

  // The 720px preview the grid has already loaded, so the photo shows the moment the viewer opens.
  // 宫格已经加载过的 720px 预览图，查看器一打开照片就能显示。
  const placeholderFor = useCallback(
    (image: ViewerImage) => {
      const photo = byId.get(image.id);
      if (!photo) return null;
      if (photo.local?.previewUrl) return photo.local.previewUrl;
      return photo.media.previewKey && mediaToken ? mediaUrl(photo.media.previewKey, mediaToken) : null;
    },
    [byId, mediaToken],
  );

  // Closing shrinks into the cell where it is now; a cell scrolled out of sight fades instead.
  // 关闭时缩回格子当前的位置；格子已滚出屏幕时改为淡出。
  const thumbRect = useCallback(
    (id: number) => {
      const photo = byId.get(id);
      const rect = photo ? (findMediaCell(postId, photo.index)?.getBoundingClientRect() ?? null) : null;
      if (!rect || rect.bottom <= 0 || rect.top >= window.innerHeight || rect.width === 0) return null;
      return rect;
    },
    [byId, postId],
  );

  // The page behind scrolls the document, which a wheel over the fixed viewer would otherwise move.
  // 后面的页面滚动的是文档，滚轮在固定的查看器上滚动时本会带动它。
  useEffect(() => {
    const stop = (event: WheelEvent) => event.preventDefault();
    window.addEventListener('wheel', stop, { passive: false });
    return () => window.removeEventListener('wheel', stop);
  }, []);

  // The post lost its photos (deleted, or gone for this viewer): nothing is left to show.
  // 动态的照片已不存在（被删除，或对查看者不再可见）：没有可显示的内容。
  useEffect(() => {
    if (!start) onClose();
  }, [start, onClose]);

  if (!start) return null;

  const canAct = view.local === null && view.post.canInteract;
  const commentCount = view.comments.length + view.moreComments;
  const footer = (
    <div
      className="flex items-center gap-1 bg-gradient-to-t from-black/60 to-transparent pt-8 text-[15px] text-white"
      style={{ paddingLeft: 'max(8px, var(--safe-left))', paddingRight: 'max(16px, var(--safe-right))', paddingBottom: 'max(8px, var(--safe-bottom))' }}
    >
      {canAct ? (
        <>
          <button
            type="button"
            onClick={onLike}
            aria-pressed={view.liked}
            className="flex h-11 items-center gap-1.5 rounded-md px-3 active:bg-white/10"
          >
            <HeartIcon filled={view.liked} />
            {view.liked ? tr('取消', 'Unlike') : tr('赞', 'Like')}
          </button>
          <button type="button" onClick={onComment} className="flex h-11 items-center gap-1.5 rounded-md px-3 active:bg-white/10">
            <CommentIcon />
            {tr('评论', 'Comment')}
          </button>
        </>
      ) : null}
      {view.likeCount > 0 || commentCount > 0 ? (
        <p className="ml-auto flex min-h-11 items-center gap-3 text-[13px] text-white/90">
          <span className="sr-only">{tr(`${view.likeCount} 个赞，${commentCount} 条评论`, `${view.likeCount} likes, ${commentCount} comments`)}</span>
          {view.likeCount > 0 ? (
            <span className="flex items-center gap-1" aria-hidden>
              <HeartIcon filled className="h-4 w-4" />
              {view.likeCount}
            </span>
          ) : null}
          {commentCount > 0 ? (
            <span className="flex items-center gap-1" aria-hidden>
              <CommentIcon className="h-4 w-4" />
              {commentCount}
            </span>
          ) : null}
        </p>
      ) : null}
    </div>
  );

  return (
    <ImageViewer
      images={images}
      startId={start.image.id}
      startRect={startRect}
      mediaToken={mediaToken}
      thumbRect={thumbRect}
      onClose={onClose}
      srcFor={srcFor}
      placeholderFor={placeholderFor}
      footer={footer}
    />
  );
}
