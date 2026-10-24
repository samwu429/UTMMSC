import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useTr } from '../../../shared/i18n/locale';
import { ActionSheet, type ActionSheetOption } from '../../../shared/ui/ActionSheet';
import { useBackToClose } from '../../../shared/ui/overlayHistory';
import { useLongPress, type LongPressInfo } from '../../../shared/ui/useLongPress';
import { WxSpinner } from '../../../shared/ui/WxSpinner';
import type { UploadItem } from '../model';
import { BackIcon, BLANK_POSTER, MoreIcon, PlayGlyph } from '../icons';
import { formatVideoClock } from '../viewer/videoClock';
import { DELETE_ZONE_HEIGHT, TILE_COLUMNS, TILE_GAP, inDeleteZone, shiftedSlot, slotAt, slotOrigin, tileMoves, tileSide, type GridGeometry } from './reorder';

type Translate = (zh: string, en: string) => string;

export interface MediaTilesProps {
  items: readonly UploadItem[];
  /** Show the "+" tile: fewer than nine photos and no video. */
  /** 显示「+」图块：照片少于九张且没有视频。 */
  canAdd: boolean;
  online: boolean;
  /** The "+" tile: the composer offers 拍照 / 录像 / 从相册选择 inside this tap. */
  /** 「+」图块：编辑器在这次点击中提供「拍照 / 录像 / 从相册选择」。 */
  onAdd(): void;
  onRetry(id: string): void;
  onRemove(id: string): void;
  onMove(from: number, to: number): void;
}

/** A tile being held: where it started, the slot it is over and how far it moved. */
/** 正被按住拖动的图块：起始位置、当前悬停的位置以及移动的距离。 */
interface DragState {
  id: string;
  geometry: GridGeometry;
  from: number;
  to: number;
  dx: number;
  dy: number;
  overDelete: boolean;
}


function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

function tileLabel(item: UploadItem, index: number, count: number, online: boolean, tr: Translate): string {
  const clock = formatVideoClock(item.local.durationMs);
  const base =
    item.local.kind === 'video'
      ? clock
        ? tr(`视频，时长 ${clock}`, `Video, ${clock}`)
        : tr('视频', 'Video')
      : tr(`图片 ${index + 1}，共 ${count} 张`, `Photo ${index + 1} of ${count}`);
  const percent = Math.round(item.progress * 100);
  switch (item.status) {
    case 'preparing':
      return tr(`${base}，正在处理`, `${base}, preparing`);
    case 'queued':
      return online ? tr(`${base}，等待上传`, `${base}, waiting to upload`) : tr(`${base}，等待网络`, `${base}, waiting for network`);
    case 'uploading':
      return tr(`${base}，已上传 ${percent}%`, `${base}, ${percent}% uploaded`);
    case 'failed':
      return tr(`${base}，上传失败，轻触重试`, `${base}, upload failed. Tap to retry`);
    case 'done':
      return base;
  }
}

/** A white ring that fills clockwise with the upload. */
/** 随上传进度顺时针填满的白色圆环。 */
function ProgressRing({ progress }: { progress: number }) {
  const radius = 13;
  const circumference = 2 * Math.PI * radius;
  const shown = Math.max(0.04, Math.min(1, progress));
  return (
    <svg viewBox="0 0 32 32" className="h-8 w-8 -rotate-90 drop-shadow" aria-hidden>
      <circle cx="16" cy="16" r={radius} fill="none" stroke="#fff" strokeOpacity="0.35" strokeWidth="3" />
      <circle
        cx="16"
        cy="16"
        r={radius}
        fill="none"
        stroke="#fff"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - shown)}
        className="transition-[stroke-dashoffset] duration-200 motion-reduce:transition-none"
      />
    </svg>
  );
}

function FailedMark() {
  return (
    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-wx-red text-[17px] font-bold leading-none text-white shadow" aria-hidden>
      !
    </span>
  );
}

function PlusGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-9 w-9" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" aria-hidden>
      <path d="M12 4v16M4 12h16" />
    </svg>
  );
}

function TrashGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4.5 7h15M9.5 7V5.2c0-.7.5-1.2 1.2-1.2h2.6c.7 0 1.2.5 1.2 1.2V7M6.5 7l.8 11.6c.1 1 .9 1.9 2 1.9h5.4c1.1 0 1.9-.9 2-1.9L17.5 7M10 10.5v6.5M14 10.5v6.5" />
    </svg>
  );
}

/** What a tile shows: the preview (or the photo), a video's glyph and length, and the upload state on top. */
/** 图块显示的内容：预览图（或照片本身）、视频的播放标志和时长，以及叠加在上面的上传状态。 */
function TileFace({ item }: { item: UploadItem }) {
  const { local } = item;
  const clock = formatVideoClock(local.durationMs);
  const src = local.kind === 'video' ? local.previewUrl : (local.previewUrl ?? local.fileUrl);
  const preparing = item.status === 'preparing';
  return (
    <>
      {src && !preparing ? (
        <img src={src} alt="" draggable={false} decoding="async" className="pointer-events-none h-full w-full select-none object-cover" />
      ) : (
        <span className={`block h-full w-full ${local.kind === 'video' && !preparing ? 'bg-[#2B2B2B]' : 'bg-wx-canvas'}`} />
      )}
      {local.kind === 'video' && !preparing ? (
        <>
          <span className="absolute inset-0 flex items-center justify-center">
            <PlayGlyph size={32} />
          </span>
          {clock ? <span className="absolute bottom-1 right-1 rounded-[3px] bg-black/45 px-1 text-[11px] leading-4 tabular-nums text-white">{clock}</span> : null}
        </>
      ) : null}
      {preparing ? (
        <span className="absolute inset-0 flex items-center justify-center">
          <WxSpinner size={20} label="" />
        </span>
      ) : null}
      {item.status === 'queued' || item.status === 'uploading' ? (
        <span className="absolute inset-0 flex items-center justify-center bg-black/30">
          <ProgressRing progress={item.progress} />
        </span>
      ) : null}
      {item.status === 'failed' ? (
        <span className="absolute inset-0 flex items-center justify-center bg-black/40">
          <FailedMark />
        </span>
      ) : null}
    </>
  );
}

interface TileProps {
  item: UploadItem;
  index: number;
  count: number;
  online: boolean;
  style: CSSProperties;
  held: boolean;
  onTap(item: UploadItem, index: number): void;
  onHold(item: UploadItem, index: number, info: LongPressInfo, pointerType: string): void;
}

function Tile({ item, index, count, online, style, held, onTap, onHold }: TileProps) {
  const tr = useTr();
  const pointerType = useRef('');
  const { handlers, pressed } = useLongPress({ onLongPress: (info) => onHold(item, index, info, pointerType.current) });
  return (
    <li className="relative aspect-square" style={{ zIndex: held ? 10 : undefined }}>
      <button
        type="button"
        {...handlers}
        onPointerDown={(event) => {
          pointerType.current = event.pointerType;
          handlers.onPointerDown(event);
        }}
        onClick={() => onTap(item, index)}
        aria-label={tileLabel(item, index, count, online, tr)}
        aria-haspopup="dialog"
        className={`absolute inset-0 block select-none overflow-hidden bg-wx-canvas [-webkit-touch-callout:none] ${pressed && !held ? 'opacity-80' : ''} ${held ? 'shadow-xl ring-2 ring-white' : ''}`}
        style={style}
      >
        <TileFace item={item} />
      </button>
    </li>
  );
}

/** The red bar that slides up while a tile is held: drop the tile on it to remove it. */
/** 按住图块时从底部升起的红色区域：把图块拖到上面松手即可删除。 */
function DeleteZone({ over, zoneRef }: { over: boolean; zoneRef: RefObject<HTMLDivElement> }) {
  const tr = useTr();
  return createPortal(
    <div
      ref={zoneRef}
      aria-hidden
      className={`wx-slide-up pointer-events-none fixed inset-x-0 bottom-0 z-[55] flex flex-col items-center justify-center gap-1 text-[13px] text-white transition-colors motion-reduce:transition-none ${over ? 'bg-wx-red' : 'bg-wx-red/85'}`}
      style={{ height: `calc(${DELETE_ZONE_HEIGHT}px + var(--safe-bottom))`, paddingBottom: 'var(--safe-bottom)' }}
    >
      <TrashGlyph />
      <span>{over ? tr('松手即可删除', 'Release to delete') : tr('拖到此处删除', 'Drag here to delete')}</span>
    </div>,
    document.body,
  );
}

interface TilePreviewProps {
  items: readonly UploadItem[];
  id: string;
  /** The tile sheet is open over the preview, so Escape and the arrows belong to it. */
  /** 图块菜单正打开在预览之上，此时 Escape 和方向键归菜单处理。 */
  covered: boolean;
  onShow(id: string): void;
  onActions(id: string): void;
  onClose(): void;
}

/** Swipes shorter than this do not change the photo. */
/** 短于这个距离的滑动不会切换照片。 */
const SWIPE_MIN_PX = 50;

/**
 * Full-screen look at one picked photo or video, from a tap on its tile: swipe or the arrow keys move
 * between tiles, and ··· opens 设为第一张 / 前移 / 后移 / 删除, the path that needs no drag.
 * 轻触图块后全屏查看选中的照片或视频：左右滑动或方向键在图块之间切换，「···」打开「设为第一张 / 前移 / 后移 / 删除」，这是不需要拖动的操作方式。
 */
function TilePreview({ items, id, covered, onShow, onActions, onClose }: TilePreviewProps) {
  const tr = useTr();
  const closeRef = useRef<HTMLButtonElement>(null);
  const swipe = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const [trigger] = useState<Element | null>(() => (typeof document === 'undefined' ? null : document.activeElement));
  const index = items.findIndex((item) => item.id === id);
  const item = index >= 0 ? items[index] : undefined;
  const latest = useRef({ items, index, covered, onShow, onClose });

  useLayoutEffect(() => {
    latest.current = { items, index, covered, onShow, onClose };
  });

  useBackToClose(onClose);

  useLayoutEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [trigger]);

  useEffect(() => {
    if (!item) onClose();
  }, [item, onClose]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const { items: list, index: at, covered: busy, onShow: show, onClose: close } = latest.current;
      if (busy) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      } else if (event.key === 'ArrowLeft' && at > 0) {
        event.preventDefault();
        show(list[at - 1]?.id ?? '');
      } else if (event.key === 'ArrowRight' && at < list.length - 1) {
        event.preventDefault();
        show(list[at + 1]?.id ?? '');
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  if (!item) return null;

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    // A drag along the video's own scrubber is not a swipe.
    // 在视频自带的进度条上拖动不算滑动。
    if (!event.isPrimary || event.target instanceof HTMLVideoElement) return;
    swipe.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const start = swipe.current;
    swipe.current = null;
    if (!start || start.pointerId !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy)) return;
    const next = items[index + (dx < 0 ? 1 : -1)];
    if (next) onShow(next.id);
  }

  const { local } = item;
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={tr('预览', 'Preview')} className="wx-fade fixed inset-0 z-[58] flex flex-col bg-black text-white">
      <div className="flex h-11 shrink-0 items-center justify-between" style={{ marginTop: 'var(--safe-top)', paddingLeft: 'var(--safe-left)', paddingRight: 'var(--safe-right)' }}>
        <button ref={closeRef} type="button" onClick={onClose} aria-label={tr('关闭', 'Close')} className="flex h-11 w-11 items-center justify-center active:opacity-60">
          <BackIcon className="h-6 w-6" />
        </button>
        <span className="text-[15px] tabular-nums" aria-live="polite">
          {index + 1}/{items.length}
        </span>
        <button type="button" onClick={() => onActions(item.id)} aria-label={tr('更多操作', 'More actions')} aria-haspopup="dialog" className="flex h-11 w-11 items-center justify-center active:opacity-60">
          <MoreIcon className="h-6 w-6" />
        </button>
      </div>
      <div
        className="flex min-h-0 flex-1 touch-pan-y items-center justify-center overflow-hidden"
        style={{ paddingBottom: 'var(--safe-bottom)', paddingLeft: 'var(--safe-left)', paddingRight: 'var(--safe-right)' }}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          swipe.current = null;
        }}
      >
        {local.kind === 'video' ? (
          <video key={item.id} src={local.fileUrl} poster={local.previewUrl ?? BLANK_POSTER} controls playsInline className="max-h-full max-w-full bg-black" />
        ) : (
          <img key={item.id} src={local.fileUrl} alt="" draggable={false} className="max-h-full max-w-full select-none object-contain [-webkit-touch-callout:none]" />
        )}
      </div>
    </div>,
    document.body,
  );
}

/**
 * The composer's media grid: three columns of square tiles with a progress ring while uploading, a red「!」
 * on a failed tile (tap to retry), and the "+" tile. Long-press a tile and drag it to reorder, or drop it on
 * 拖到此处删除 to remove it. A tap opens the preview, whose ··· offers the same moves without dragging; the
 * ContextMenu key or Shift+F10 opens them directly.
 * 编辑器的媒体网格：三列正方形图块，上传时显示进度环，失败的图块显示红色「!」（轻触重试），以及「+」图块。长按图块拖动可调整顺序，
 * 拖到「拖到此处删除」上松手即可删除。轻触打开预览，其「···」不用拖动也能完成同样的调整；ContextMenu 键或 Shift+F10 可直接打开这些操作。
 */
export function MediaTiles({ items, canAdd, online, onAdd, onRetry, onRemove, onMove }: MediaTilesProps) {
  const tr = useTr();
  const gridRef = useRef<HTMLUListElement>(null);
  const zoneRef = useRef<HTMLDivElement>(null);
  const stopDrag = useRef<(() => void) | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const latest = useRef({ items, onMove, onRemove });

  useLayoutEffect(() => {
    latest.current = { items, onMove, onRemove };
  });

  useEffect(() => () => stopDrag.current?.(), []);

  const closePreview = useCallback(() => setPreviewId(null), []);

  const updateDrag = useCallback((next: DragState | null) => {
    dragRef.current = next;
    setDrag(next);
  }, []);

  const endDrag = useCallback(
    (commit: boolean) => {
      const state = dragRef.current;
      stopDrag.current?.();
      stopDrag.current = null;
      updateDrag(null);
      if (!state || !commit) return;
      const { items: list, onMove: move, onRemove: remove } = latest.current;
      // The tiles may have changed while held (a preparation failed); act on the held one by id.
      // 按住期间图块可能已变化（某个文件处理失败）；按 id 处理被按住的那个。
      const from = list.findIndex((item) => item.id === state.id);
      if (from < 0) return;
      if (state.overDelete) remove(state.id);
      else if (state.to !== from) move(from, Math.min(state.to, list.length - 1));
    },
    [updateDrag],
  );

  function startDrag(item: UploadItem, index: number, info: LongPressInfo) {
    const grid = gridRef.current;
    if (!grid || stopDrag.current) return;
    const rect = grid.getBoundingClientRect();
    const geometry: GridGeometry = { left: rect.left, top: rect.top, cell: tileSide(rect.width), gap: TILE_GAP, columns: TILE_COLUMNS };
    const origin = slotOrigin(geometry, index);
    const originX = rect.left + origin.x;
    const originY = rect.top + origin.y;
    const count = items.length;
    const grabX = info.clientX - originX;
    const grabY = info.clientY - originY;

    const onPointerMove = (event: PointerEvent) => {
      if (!event.isPrimary) return;
      const x = event.clientX - grabX;
      const y = event.clientY - grabY;
      // The zone sits at the bottom of the viewport; its height, unlike its box, ignores the slide-up animation.
      // 删除区域位于视口底部；它的高度与外框不同，不受升起动画的影响。
      const zoneTop = window.innerHeight - (zoneRef.current?.offsetHeight ?? DELETE_ZONE_HEIGHT);
      const overDelete = inDeleteZone(event.clientY, zoneTop);
      const to = slotAt(geometry, count, x + geometry.cell / 2, y + geometry.cell / 2);
      const state = dragRef.current;
      if (state) updateDrag({ ...state, to, dx: x - originX, dy: y - originY, overDelete });
    };
    const onPointerUp = (event: PointerEvent) => {
      if (event.isPrimary) endDrag(true);
    };
    const onPointerCancel = () => endDrag(false);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      endDrag(false);
    };
    // The finger held still for the long press, so no scroll has started and touchmove can still be cancelled.
    // 长按期间手指没有移动，滚动尚未开始，因此 touchmove 仍可取消。
    const blockScroll = (event: TouchEvent) => {
      if (event.cancelable) event.preventDefault();
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('touchmove', blockScroll, { passive: false });
    stopDrag.current = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('touchmove', blockScroll);
    };
    updateDrag({ id: item.id, geometry, from: index, to: index, dx: 0, dy: 0, overDelete: false });
  }

  function onHold(item: UploadItem, index: number, info: LongPressInfo, pointerType: string) {
    // A held finger or pen drags; a right-click, the system long press of a mouse or the keyboard opens the moves.
    // 按住的手指或触控笔开始拖动；右键、鼠标触发的系统长按或键盘则打开调整菜单。
    const fromTouch = info.source === 'pointer' || (info.source === 'contextmenu' && info.held && pointerType !== 'mouse');
    if (fromTouch && info.held) startDrag(item, index, info);
    else setSheetId(item.id);
  }

  function onTap(item: UploadItem) {
    if (dragRef.current) return;
    if (item.status === 'failed') onRetry(item.id);
    else setPreviewId(item.id);
  }

  const reduced = prefersReducedMotion();

  function tileStyle(item: UploadItem, index: number): CSSProperties {
    if (!drag) return {};
    const { geometry } = drag;
    if (item.id === drag.id) {
      return { transform: `translate3d(${drag.dx}px, ${drag.dy}px, 0) scale(${reduced ? 1 : 1.06})`, transition: 'none', opacity: drag.overDelete ? 0.6 : 1 };
    }
    const to = drag.overDelete ? drag.from : drag.to;
    const slot = shiftedSlot(index, drag.from, to);
    const home = slotOrigin(geometry, index);
    const target = slotOrigin(geometry, slot);
    return {
      transform: `translate3d(${target.x - home.x}px, ${target.y - home.y}px, 0)`,
      transition: reduced ? 'none' : 'transform 150ms ease-out',
    };
  }

  const sheetIndex = sheetId ? items.findIndex((item) => item.id === sheetId) : -1;
  const sheetOptions: ActionSheetOption[] = [];
  if (sheetId && sheetIndex >= 0) {
    const moves = tileMoves(sheetIndex, items.length);
    const id = sheetId;
    const at = () => latest.current.items.findIndex((item) => item.id === id);
    if (moves.first) sheetOptions.push({ label: tr('设为第一张', 'Make first'), onSelect: () => at() > 0 && onMove(at(), 0) });
    if (moves.earlier) sheetOptions.push({ label: tr('前移', 'Move earlier'), onSelect: () => at() > 0 && onMove(at(), at() - 1) });
    if (moves.later) sheetOptions.push({ label: tr('后移', 'Move later'), onSelect: () => at() >= 0 && onMove(at(), at() + 1) });
    sheetOptions.push({
      label: tr('删除', 'Delete'),
      danger: true,
      onSelect: () => {
        setPreviewId(null);
        onRemove(id);
      },
    });
  }

  return (
    <>
      <ul ref={gridRef} role="list" aria-label={tr('照片和视频', 'Photos and videos')} className="grid max-w-[22rem] grid-cols-3" style={{ gap: TILE_GAP }}>
        {items.map((item, index) => (
          <Tile
            key={item.id}
            item={item}
            index={index}
            count={items.length}
            online={online}
            style={tileStyle(item, index)}
            held={drag?.id === item.id}
            onTap={onTap}
            onHold={onHold}
          />
        ))}
        {canAdd ? (
          <li className="aspect-square">
            <button
              type="button"
              onClick={onAdd}
              aria-label={tr('添加照片或视频', 'Add photos or a video')}
              aria-haspopup="dialog"
              className="flex h-full w-full items-center justify-center bg-wx-bar text-wx-meta active:bg-wx-pressed"
            >
              <PlusGlyph />
            </button>
          </li>
        ) : null}
      </ul>
      {drag ? <DeleteZone over={drag.overDelete} zoneRef={zoneRef} /> : null}
      {previewId ? <TilePreview items={items} id={previewId} covered={sheetId !== null} onShow={setPreviewId} onActions={setSheetId} onClose={closePreview} /> : null}
      {sheetId && sheetIndex >= 0 ? <ActionSheet options={sheetOptions} onClose={() => setSheetId(null)} /> : null}
    </>
  );
}
