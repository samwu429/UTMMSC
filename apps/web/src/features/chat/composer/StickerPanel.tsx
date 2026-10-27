import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
} from 'react';
import { STICKER_MESSAGES, STICKER_PICK_MAX, type StickerItem } from '@utmmsc/shared';
import { localizedMessage } from '../../../shared/api/errors';
import { useTr } from '../../../shared/i18n/locale';
import { useReducedMotion } from '../../../shared/media/reducedMotion';
import { useSessionStore } from '../../../shared/session/store';
import { ActionSheet } from '../../../shared/ui/ActionSheet';
import { toast } from '../../../shared/ui/toast';
import { vibrateForLongPress } from '../../../shared/ui/useLongPress';
import { WxSpinner } from '../../../shared/ui/WxSpinner';
import type { Translate } from '../format/systemText';
import { stickerBatchToast, stickerPrepToast } from '../stickers/fromMessage';
import { saveDataPreferred } from '../stickers/media';
import { recentStickers, useStickerLibrary, type StickerLibraryState, type StickerUploadTile } from '../stickers/store';
import {
  buildGridTiles,
  buildRecentTiles,
  createPeekGesture,
  moveGridFocus,
  planStickerPick,
  stickerColumns,
  stickerPanelLayout,
  stickerTileSize,
  type GridPoint,
  type GridRect,
  type PeekSource,
  type StickerGridTile,
} from './stickerGrid';
import { StickerPeek } from './StickerPeek';
import { AddStickerTile, StickerTile, UploadStickerTile } from './StickerTile';

export type GridTile = StickerGridTile<StickerItem, StickerUploadTile>;

export interface StickerGridSection {
  key: string;
  /** The visible heading above the section, or null. */
  /** 区域上方显示的标题，没有时为 null。 */
  heading: string | null;
  /** The section's name for screen readers; null when the section is the whole grid and its container names it. */
  /** 区域对读屏软件的名称；区域就是整个格子、且外层容器已有名称时为 null。 */
  label: string | null;
  tiles: readonly GridTile[];
}

/** Stickers held or on their way, which count against the collection's size before a pick. */
/** 已有的和正在添加的表情，选择文件前它们都计入表情列表的数量。 */
function heldStickers(state: Pick<StickerLibraryState, 'items' | 'uploads'>): number {
  return state.items.length + state.uploads.filter((tile) => tile.status !== 'failed').length;
}

/** Whether another pick can add anything; when the collection is full it says so instead of opening the picker. */
/** 是否还能再选择文件添加；表情列表已满时直接提示，而不是打开选择器。 */
export function roomForStickerPick(): boolean {
  const library = useStickerLibrary.getState();
  if (!planStickerPick(1, { held: heldStickers(library), max: library.max }).full) return true;
  toast(localizedMessage(STICKER_MESSAGES.full));
  return false;
}

/**
 * What the composer's and the manage screen's sticker inputs do with a pick: the first 9 files (P16 when there were
 * more), nothing when the collection is full, the preparation problems toasted at once (P18), and once the uploads end
 * the limit that stopped them or M3b.
 * 输入栏和管理界面的表情文件选择框对一次选择的处理：取前 9 个文件（超过时提示 P16），表情列表已满时什么都不做，
 * 处理中发现的问题立即提示（P18），上传全部结束后提示使其停止的上限或 M3b。
 */
export function addPickedStickers(list: FileList | null, tr: Translate): void {
  const files = list ? Array.from(list) : [];
  if (!files.length) return;
  const library = useStickerLibrary.getState();
  const plan = planStickerPick(files.length, { held: heldStickers(library), max: library.max });
  if (plan.full) {
    toast(localizedMessage(STICKER_MESSAGES.full));
    return;
  }
  if (plan.tooMany) toast(tr(`一次最多添加 ${STICKER_PICK_MAX} 个`, `Add up to ${STICKER_PICK_MAX} at a time`));
  void library
    .addFiles(files.slice(0, plan.take), {
      onPrepared: (problems) => {
        const text = stickerPrepToast(problems, tr);
        if (text) toast(text);
      },
    })
    .then((outcomes) => {
      const text = stickerBatchToast(outcomes, tr);
      if (text) toast(text);
    });
}

/** The element's width, measured before paint and again whenever it changes size. */
/** 元素的宽度，在绘制前测量，尺寸变化时重新测量。 */
export function useElementWidth(ref: RefObject<HTMLElement>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setWidth(element.getBoundingClientRect().width);
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

interface Peek {
  index: number;
  sticker: StickerItem;
  rect: GridRect;
  point: GridPoint;
  source: PeekSource | 'focus';
}

function rectOf(element: Element): GridRect {
  const rect = element.getBoundingClientRect();
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

function focusVisible(element: Element): boolean {
  try {
    return element.matches(':focus-visible');
  } catch {
    // Browsers without :focus-visible: keyboard focus cannot be told apart, so nothing peeks.
    // 不支持 :focus-visible 的浏览器无法分辨键盘焦点，因此不显示预览。
    return false;
  }
}

interface StickerGridProps {
  sections: readonly StickerGridSection[];
  columns: number;
  tileSize: number;
  /** The manage screen's selection mode: stickers become checkboxes. */
  /** 管理界面的选择模式：表情变成复选框。 */
  selecting?: boolean;
  selected?: ReadonlySet<string>;
  onAdd(): void;
  onSticker(sticker: StickerItem): void;
}

const NONE: ReadonlySet<string> = new Set();

/**
 * A sticker grid, in sections laid out one after another: the panel's 最近使用 and 我的表情, or the manage screen's one.
 * One delegated handler serves every tile: a tap acts (send, select, pick, the failed upload's sheet) unless it stopped
 * a scroll; a 450 ms hold peeks and the card follows the finger; a resting mouse and keyboard focus peek too. Arrows,
 * Home and End move a roving focus.
 * 表情格子，由依次排列的区域组成：面板中的「最近使用」和「我的表情」，或管理界面中的唯一一个区域。所有格子共用一个委托处理器：
 * 点按会执行相应操作（发送、选择、选择文件、失败上传的操作表），除非这次点按是在停住滚动；按住 450ms 显示预览，卡片随手指移动；
 * 鼠标停留和键盘聚焦也会显示预览。方向键、Home 和 End 移动可漫游的焦点。
 */
export function StickerGrid({ sections, columns, tileSize, selecting = false, selected = NONE, onAdd, onSticker }: StickerGridProps) {
  const tr = useTr();
  const token = useSessionStore((s) => s.mediaToken);
  const reducedMotion = useReducedMotion();
  const [saveData] = useState(saveDataPreferred);
  const rootRef = useRef<HTMLDivElement>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const [peek, setPeek] = useState<Peek | null>(null);
  const [sheetFor, setSheetFor] = useState<string | null>(null);

  const flat = useMemo(() => sections.flatMap((section) => section.tiles), [sections]);
  const sizes = useMemo(() => sections.map((section) => section.tiles.length), [sections]);
  const flatRef = useRef(flat);
  const handlersRef = useRef({ onAdd, onSticker });
  useLayoutEffect(() => {
    flatRef.current = flat;
    handlersRef.current = { onAdd, onSticker };
  });

  const roving = Math.min(focusIndex, Math.max(0, flat.length - 1));

  const gesture = useMemo(() => {
    function show(index: number, point: GridPoint, source: Peek['source']) {
      const tile = flatRef.current[index];
      const element = rootRef.current?.querySelector(`[data-tile="${index}"]`);
      if (tile?.kind !== 'sticker' || !element) return;
      setPeek({ index, sticker: tile.sticker, rect: rectOf(element), point, source });
    }
    return {
      show,
      controller: createPeekGesture({
        onPeek(index, point, source) {
          if (source === 'press') vibrateForLongPress();
          show(index, point, source);
        },
        onPeekMove(index, point) {
          setPeek((current) => {
            const tile = flatRef.current[index];
            const element = rootRef.current?.querySelector(`[data-tile="${index}"]`);
            if (!current || tile?.kind !== 'sticker' || !element) return current;
            return { index, sticker: tile.sticker, rect: rectOf(element), point, source: current.source };
          });
        },
        onPeekEnd() {
          setPeek(null);
        },
      }),
    };
  }, []);

  /** The tile index of an event target inside this grid, or null. */
  /** 本格子内某个事件目标所在格子的序号，没有时为 null。 */
  function tileIndexOf(target: EventTarget | null): number | null {
    if (!(target instanceof Element)) return null;
    const tile = target.closest<HTMLElement>('[data-tile]');
    if (!tile || !rootRef.current?.contains(tile)) return null;
    const index = Number(tile.dataset.tile);
    return Number.isInteger(index) && index >= 0 && index < flatRef.current.length ? index : null;
  }

  function peekableAt(point: GridPoint): number | null {
    const index = tileIndexOf(document.elementFromPoint(point.x, point.y));
    return index !== null && flatRef.current[index]?.kind === 'sticker' ? index : null;
  }

  useEffect(() => {
    const root = rootRef.current;
    const { controller } = gesture;
    const onUp = (event: globalThis.PointerEvent) => controller.up(event.pointerId, Date.now());
    const onCancel = (event: globalThis.PointerEvent) => controller.cancel(event.pointerId);
    // A scroll of the grid's own scroller (or of the page) marks the next tap as one that stops a fling.
    // 格子所在滚动容器（或整个页面）的滚动会把下一次点按标记为停住滑动的点按。
    const onScroll = (event: Event) => {
      const target = event.target;
      if (!root || !(target === document || (target instanceof Node && target.contains(root)))) return;
      controller.scrolled(Date.now());
      setPeek((current) => {
        if (!current) return current;
        const element = root.querySelector(`[data-tile="${current.index}"]`);
        return element ? { ...current, rect: rectOf(element) } : current;
      });
    };
    // While the card shows, the finger moves the card instead of scrolling the grid.
    // 卡片显示期间，手指移动的是卡片，而不是滚动格子。
    const onTouchMove = (event: TouchEvent) => {
      if (controller.peeking && controller.source === 'press' && event.cancelable) event.preventDefault();
    };
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancel, true);
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    root?.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => {
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onCancel, true);
      window.removeEventListener('scroll', onScroll, { capture: true });
      root?.removeEventListener('touchmove', onTouchMove);
      controller.dispose();
    };
  }, [gesture]);

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const index = tileIndexOf(event.target);
    if (index === null) return;
    const peekable = flat[index]?.kind === 'sticker' ? index : null;
    gesture.controller.down(peekable, { x: event.clientX, y: event.clientY }, event.pointerId, Date.now());
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    gesture.controller.move({ x: event.clientX, y: event.clientY }, event.pointerId, peekableAt);
  }

  function onPointerOver(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== 'mouse') return;
    const index = tileIndexOf(event.target);
    gesture.controller.hover(index !== null && flat[index]?.kind === 'sticker' ? index : null, { x: event.clientX, y: event.clientY });
  }

  function onPointerLeave(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'mouse') gesture.controller.leave();
  }

  function onClick(event: MouseEvent<HTMLDivElement>) {
    const index = tileIndexOf(event.target);
    if (index === null) return;
    // detail is 0 for clicks from Enter, Space and assistive technology.
    // 由回车、空格和辅助技术触发的 click，其 detail 为 0。
    const verdict = gesture.controller.click(Date.now(), event.detail === 0);
    if (verdict !== 'send') {
      event.preventDefault();
      return;
    }
    const tile = flat[index];
    if (!tile) return;
    if (tile.kind === 'add') {
      if (!tile.inactive) handlersRef.current.onAdd();
    } else if (tile.kind === 'upload') {
      if (tile.upload.status === 'failed') setSheetFor(tile.upload.localId);
    } else {
      handlersRef.current.onSticker(tile.sticker);
    }
  }

  function onContextMenu(event: MouseEvent<HTMLDivElement>) {
    if (tileIndexOf(event.target) !== null) event.preventDefault();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && peek) {
      event.preventDefault();
      event.stopPropagation();
      setPeek(null);
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const index = tileIndexOf(event.target);
    if (index === null) return;
    const next = moveGridFocus(index, event.key, sizes, columns);
    if (next === null) return;
    event.preventDefault();
    setFocusIndex(next);
    rootRef.current?.querySelector<HTMLElement>(`[data-tile="${next}"]`)?.focus();
  }

  function onFocus(event: FocusEvent<HTMLDivElement>) {
    const index = tileIndexOf(event.target);
    if (index === null) return;
    setFocusIndex(index);
    // Focus from the keyboard peeks; focus from a tap does not.
    // 来自键盘的焦点会显示预览；来自点按的焦点不会。
    if (flat[index]?.kind === 'sticker' && focusVisible(event.target)) {
      const element = event.target;
      const rect = rectOf(element);
      gesture.show(index, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }, 'focus');
    } else {
      setPeek((current) => (current?.source === 'focus' ? null : current));
    }
  }

  function onBlur(event: FocusEvent<HTMLDivElement>) {
    if (event.relatedTarget instanceof Node && rootRef.current?.contains(event.relatedTarget)) return;
    setPeek((current) => (current?.source === 'focus' ? null : current));
  }

  const sheetTile = sheetFor ? flat.find((tile): tile is Extract<GridTile, { kind: 'upload' }> => tile.kind === 'upload' && tile.upload.localId === sheetFor) : undefined;

  let offset = 0;
  return (
    <div
      ref={rootRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerOver={onPointerOver}
      onPointerLeave={onPointerLeave}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      {sections.map((section) => {
        const start = offset;
        offset += section.tiles.length;
        if (!section.tiles.length) return null;
        return (
          <div key={section.key} role={section.label ? 'group' : undefined} aria-label={section.label ?? undefined}>
            {section.heading ? (
              <p className="px-1.5 pt-2 text-[12px] leading-[18px] text-wx-meta" aria-hidden>
                {section.heading}
              </p>
            ) : null}
            <div className="grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
              {section.tiles.map((tile, i) => {
                const index = start + i;
                const focusable = index === roving;
                if (tile.kind === 'add') return <AddStickerTile key={tile.key} index={index} focusable={focusable} inactive={tile.inactive} />;
                if (tile.kind === 'upload') return <UploadStickerTile key={tile.key} upload={tile.upload} index={index} focusable={focusable} />;
                return (
                  <StickerTile
                    key={tile.key}
                    sticker={tile.sticker}
                    index={index}
                    playKey={tile.key}
                    number={tile.number}
                    token={token}
                    reducedMotion={reducedMotion}
                    saveData={saveData}
                    focusable={focusable}
                    selecting={selecting}
                    checked={selecting && selected.has(tile.sticker.id)}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
      {peek ? <StickerPeek sticker={peek.sticker} tile={peek.rect} point={peek.point} tileSize={tileSize} /> : null}
      {sheetTile ? (
        <ActionSheet
          title={sheetTile.upload.failure ?? tr('添加失败，点按重试', "Couldn't add. Tap to retry.")}
          options={[
            { label: tr('重试', 'Retry'), onSelect: () => useStickerLibrary.getState().retryUpload(sheetTile.upload.localId) },
            { label: tr('移除', 'Remove'), onSelect: () => useStickerLibrary.getState().dropUpload(sheetTile.upload.localId) },
          ]}
          onClose={() => setSheetFor(null)}
        />
      ) : null}
    </div>
  );
}

/** 最近使用, read once when there is a collection to read it from, so the row does not move under the finger. */
/** 「最近使用」：在有表情列表可读时只读取一次，这一行因此不会在手指下移动。 */
function useRecentOnce(items: readonly StickerItem[]): readonly StickerItem[] {
  const [recent, setRecent] = useState<readonly StickerItem[] | null>(() => {
    const state = useStickerLibrary.getState();
    return state.items.length ? recentStickers(state) : null;
  });
  useEffect(() => {
    if (recent === null && items.length > 0) setRecent(recentStickers(useStickerLibrary.getState()));
  }, [recent, items]);
  // Anything removed meanwhile (from another device's list) leaves the row.
  // 期间被删除的表情（来自其他设备的列表）会离开这一行。
  return useMemo(() => {
    if (!recent) return [];
    const present = new Set(items.map((item) => item.id));
    return recent.filter((item) => present.has(item.id));
  }, [recent, items]);
}

/**
 * The 我的表情 tab of the expression panel: 最近使用 and the collection once it passes two rows, else the collection
 * alone from 8 px below the top, so two full rows show on the first screen. A tap sends; the + tile adds from the
 * album. Shows the saved list at once and refreshes it in the background.
 * 表情面板的「我的表情」标签：表情超过两行后显示「最近使用」和表情列表，否则只显示表情列表，从顶部下方 8px 开始，第一屏因此能完整
 * 显示两行。点按即发送；+ 格子从相册添加。立即显示已保存的列表，并在后台刷新。
 */
export function StickerPanel({ onSend, onAdd }: { onSend(sticker: StickerItem): void; onAdd(): void }) {
  const tr = useTr();
  const describedBy = useId();
  const status = useStickerLibrary((s) => s.status);
  const items = useStickerLibrary((s) => s.items);
  const uploads = useStickerLibrary((s) => s.uploads);
  const scrollRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(scrollRef);
  const recent = useRecentOnce(items);

  useEffect(() => {
    void useStickerLibrary.getState().ensureFresh();
  }, []);

  const columns = stickerColumns(width);
  const tileSize = stickerTileSize(width);
  const { showRecent, showHeadings } = stickerPanelLayout({ items: items.length, columns, recent: recent.length });
  const mineLabel = tr('我的表情', 'My stickers');
  const recentLabel = tr('最近使用', 'Recent');
  const sections = useMemo<StickerGridSection[]>(() => {
    const mine: StickerGridSection = {
      key: 'mine',
      heading: showHeadings ? mineLabel : null,
      label: showRecent ? mineLabel : null,
      tiles: buildGridTiles(items, uploads, { addInactive: false }),
    };
    if (!showRecent) return [mine];
    return [{ key: 'recent', heading: recentLabel, label: recentLabel, tiles: buildRecentTiles(recent, columns) }, mine];
  }, [items, uploads, recent, columns, showRecent, showHeadings, mineLabel, recentLabel]);

  const empty = items.length === 0 && uploads.length === 0;
  const loading = empty && (status === 'loading' || status === 'idle');
  const failed = empty && status === 'error';

  return (
    <div
      ref={scrollRef}
      role="group"
      aria-label={mineLabel}
      aria-describedby={describedBy}
      className="box-border h-full touch-pan-y overflow-y-auto overscroll-contain border-t-[0.5px] border-wx-line bg-wx-bar px-3 pb-3"
    >
      <span id={describedBy} className="sr-only">
        {tr('点按发送', 'Tap to send.')}
      </span>
      {loading ? (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-[13px] text-wx-meta">
          <WxSpinner label={tr('加载中', 'Loading')} />
          <span aria-hidden>{tr('加载中', 'Loading')}</span>
        </div>
      ) : failed ? (
        <div className="flex h-full flex-col items-center justify-center text-[13px] text-wx-meta">
          <p>{tr('表情加载失败', "Couldn't load stickers")}</p>
          <button type="button" onClick={() => void useStickerLibrary.getState().ensureFresh()} className="mt-1 min-h-11 px-3 text-[14px] text-wx-link">
            {tr('重试', 'Retry')}
          </button>
        </div>
      ) : (
        <div className={showHeadings ? '' : 'pt-2'}>
          <StickerGrid sections={sections} columns={columns} tileSize={tileSize} onAdd={onAdd} onSticker={onSend} />
          {empty ? (
            <p className="px-3 pt-3 text-center text-[13px] leading-relaxed text-wx-meta">
              {tr('点 + 从相册添加，也可以在聊天中长按表情或图片添加', 'Tap + to add from your photos, or long-press a sticker or photo in a chat.')}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
