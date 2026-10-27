import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useLocation, useNavigate, type Location } from 'react-router-dom';
import type { StickerItem } from '@utmmsc/shared';
import { useTr } from '../../../shared/i18n/locale';
import { BackHeader } from '../../../shared/ui/BackHeader';
import { SNACKBAR_LIFT_VAR, dismissSnackbar, snackbar } from '../../../shared/ui/snackbar';
import { toast } from '../../../shared/ui/toast';
import { WxSpinner } from '../../../shared/ui/WxSpinner';
import { StickerGrid, addPickedStickers, roomForStickerPick, useElementWidth, type StickerGridSection } from '../composer/StickerPanel';
import { buildGridTiles, stickerColumns, stickerTileSize } from '../composer/stickerGrid';
import { STICKER_PICK_ACCEPT } from '../stickers/prep';
import { useStickerLibrary } from '../stickers/store';
import { NO_STICKER_SELECTION, allStickersSelected, selectedInOrder, stickerSelectionReducer } from './stickerSelection';

/** True when there is an in-app page to return to, rather than a page opened straight from a link. */
/** 存在可返回的站内页面时为 true，而不是直接从链接打开的页面。 */
function canGoBack(location: Location): boolean {
  if (location.key === 'default') return false;
  const index = (window.history.state as { idx?: unknown } | null)?.idx;
  return typeof index !== 'number' || index > 0;
}

/** Height of the selection bar above the safe area. */
/** 选择操作栏在安全区之上的高度。 */
const BAR_PX = 56;

/**
 * The selection bar: 全选 on the left, 移到最前 in the middle, 删除 on the right. It is fixed to the bottom above the
 * home indicator and lifts the snackbar above itself, as StickyActionBar does.
 * 选择操作栏：左边「全选」，中间「移到最前」，右边「删除」。固定在屏幕底部、主屏幕指示条之上，并把提示条抬到自己上方，与 StickyActionBar 一样。
 */
function SelectionBar({ allSelected, count, onToggleAll, onFront, onDelete }: { allSelected: boolean; count: number; onToggleAll: () => void; onFront: () => void; onDelete: () => void }) {
  const tr = useTr();
  const [element, setElement] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!element) return;
    const style = document.documentElement.style;
    const measure = () => style.setProperty(SNACKBAR_LIFT_VAR, `${element.offsetHeight}px`);
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => {
      observer?.disconnect();
      style.removeProperty(SNACKBAR_LIFT_VAR);
    };
  }, [element]);

  const action = 'min-h-11 shrink-0 rounded-md px-3 text-[16px] active:bg-wx-pressed disabled:active:bg-transparent';
  return (
    <div
      ref={setElement}
      className="fixed inset-x-0 bottom-0 z-30 border-t-[0.5px] border-wx-line bg-white"
      style={{ paddingBottom: 'var(--safe-bottom)', paddingLeft: 'var(--safe-left)', paddingRight: 'var(--safe-right)' }}
    >
      <div className="mx-auto flex max-w-2xl items-center justify-between px-2" style={{ height: BAR_PX }}>
        <button type="button" onClick={onToggleAll} className={`${action} text-wx-ink`}>
          {allSelected ? tr('取消全选', 'Deselect all') : tr('全选', 'Select all')}
        </button>
        <button type="button" onClick={onFront} disabled={count === 0} className={`${action} text-wx-ink disabled:text-wx-meta disabled:opacity-60`}>
          {tr('移到最前', 'Move to front')}
        </button>
        <button type="button" onClick={onDelete} disabled={count === 0} className={`${action} font-medium text-wx-red disabled:font-normal disabled:text-wx-meta disabled:opacity-60`}>
          {count > 0 ? tr(`删除(${count})`, `Delete (${count})`) : tr('删除', 'Delete')}
        </button>
      </div>
    </div>
  );
}

/**
 * 我的表情, the manage screen (/chat/stickers), reached from the panel's gear and from 我 > 设置 > 通用. Tapping a sticker
 * (or 整理) starts selecting, with that sticker selected; the + tile keeps its cell, dimmed. 移到最前 keeps the order
 * chosen; 删除 asks nothing: the tiles go at once with a 撤销 snackbar, and the removal reaches the server when the
 * snackbar closes, when this screen closes, or when the app goes to the background.
 * 「我的表情」管理界面（/chat/stickers），从面板的齿轮以及「我 > 设置 > 通用」进入。点按表情（或「整理」）开始选择，并选中该表情；
 * + 格子留在原位并变暗。「移到最前」保持所选顺序；「删除」不再确认：格子立即消失并显示带「撤销」的提示条，删除在提示条关闭、
 * 本界面关闭或应用转到后台时才发送到服务端。
 */
export function StickersPage() {
  const tr = useTr();
  const navigate = useNavigate();
  const location = useLocation();
  const items = useStickerLibrary((s) => s.items);
  const uploads = useStickerLibrary((s) => s.uploads);
  const status = useStickerLibrary((s) => s.status);
  const max = useStickerLibrary((s) => s.max);
  const [selection, dispatch] = useReducer(stickerSelectionReducer, NO_STICKER_SELECTION);
  const inputRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(gridRef);
  // The removal whose snackbar is on screen; it is committed when that snackbar closes for any reason but 撤销.
  // 提示条正在屏幕上的那次删除；提示条因「撤销」以外的任何原因关闭时提交。
  const openRemoval = useRef<string | null>(null);

  useEffect(() => {
    void useStickerLibrary.getState().ensureFresh();
  }, []);

  // Leaving the screen closes the snackbar, which commits its removal.
  // 离开本界面会关闭提示条，从而提交其中的删除。
  useEffect(
    () => () => {
      if (openRemoval.current) dismissSnackbar();
    },
    [],
  );

  useEffect(() => {
    dispatch({ type: 'prune', ids: items.map((item) => item.id) });
  }, [items]);

  const { selecting, selected } = selection;
  const count = selected.size;
  const columns = stickerColumns(width);
  const tileSize = stickerTileSize(width);
  const label = tr('我的表情', 'My stickers');
  const sections = useMemo<StickerGridSection[]>(
    () => [{ key: 'mine', heading: null, label, tiles: buildGridTiles(items, uploads, { addInactive: selecting }) }],
    [items, uploads, selecting, label],
  );

  const from = (location.state as { from?: unknown } | null)?.from;
  const backLabel = from === 'chat' ? tr('聊天', 'Chat') : tr('设置', 'Settings');

  function goBack() {
    if (canGoBack(location)) navigate(-1);
    else navigate('/settings?tab=settings', { replace: true });
  }

  function chooseFiles() {
    if (roomForStickerPick()) inputRef.current?.click();
  }

  function tapSticker(sticker: StickerItem) {
    dispatch(selecting ? { type: 'toggle', id: sticker.id } : { type: 'enterWith', id: sticker.id });
  }

  function toggleAll() {
    if (allStickersSelected(items, selected)) dispatch({ type: 'clear' });
    else dispatch({ type: 'selectAll', ids: items.map((item) => item.id) });
  }

  function moveSelected() {
    const ids = selectedInOrder(items, selected);
    if (!ids.length) return;
    // The move shows at once; a failure puts the order back and says why.
    // 移动立即生效；失败时恢复原来的顺序并说明原因。
    void useStickerLibrary.getState().moveToFront(ids);
    toast(tr('已移到最前', 'Moved to front'));
    dispatch({ type: 'clear' });
  }

  function deleteSelected() {
    const ids = selectedInOrder(items, selected);
    if (!ids.length) return;
    const library = useStickerLibrary.getState();
    const removalId = library.stageRemoval(ids);
    dispatch({ type: 'clear' });
    openRemoval.current = removalId;
    const n = ids.length;
    snackbar({
      text: tr(`已删除 ${n} 个表情`, n === 1 ? 'Deleted 1 sticker' : `Deleted ${n} stickers`),
      action: {
        label: tr('撤销', 'Undo'),
        onAction: () => {
          if (openRemoval.current === removalId) openRemoval.current = null;
          useStickerLibrary.getState().undoRemoval(removalId);
        },
      },
      onClose: () => {
        if (openRemoval.current === removalId) openRemoval.current = null;
        void useStickerLibrary.getState().commitRemoval(removalId);
      },
    });
  }

  const empty = items.length === 0 && uploads.length === 0;
  const loading = empty && (status === 'loading' || status === 'idle');
  const failed = empty && status === 'error';

  return (
    <div className="min-h-[100dvh] overflow-x-clip bg-white" style={{ paddingLeft: 'var(--safe-left)', paddingRight: 'var(--safe-right)' }}>
      <div className="mx-auto min-h-[100dvh] max-w-2xl bg-white">
        <div className="sticky top-0 z-20 bg-white" style={{ paddingTop: 'var(--safe-top)' }}>
          <BackHeader
            flush
            onBack={goBack}
            label={backLabel}
            title={label}
            trailing={
              <button
                type="button"
                onClick={() => dispatch({ type: selecting ? 'exit' : 'enter' })}
                disabled={!selecting && items.length === 0}
                className="min-h-11 rounded-lg px-2 text-[16px] font-medium text-brand-800 active:bg-stone-100 disabled:text-stone-300 disabled:active:bg-transparent"
              >
                {selecting ? tr('完成', 'Done') : tr('整理', 'Manage')}
              </button>
            }
          />
        </div>

        <p className="px-4 pb-1 pt-3 text-[13px] text-wx-meta">{tr(`已添加 ${items.length} 个，最多 ${max} 个`, `${items.length} of ${max} stickers`)}</p>
        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {selecting ? tr(`已选择 ${count} 个`, `${count} selected`) : ''}
        </p>

        <div ref={gridRef} className="px-3" style={{ paddingBottom: selecting ? `calc(${BAR_PX + 16}px + var(--safe-bottom))` : 'max(24px, var(--safe-bottom))' }}>
          {loading ? (
            <div className="flex flex-col items-center gap-2 py-16 text-[14px] text-wx-meta">
              <WxSpinner label={tr('加载中', 'Loading')} />
              <span aria-hidden>{tr('加载中', 'Loading')}</span>
            </div>
          ) : failed ? (
            <div className="flex flex-col items-center py-16 text-[14px] text-wx-meta">
              <p>{tr('表情加载失败', "Couldn't load stickers")}</p>
              <button type="button" onClick={() => void useStickerLibrary.getState().ensureFresh()} className="mt-1 min-h-11 px-3 text-wx-link">
                {tr('重试', 'Retry')}
              </button>
            </div>
          ) : (
            <>
              <StickerGrid sections={sections} columns={columns} tileSize={tileSize} selecting={selecting} selected={selected} onAdd={chooseFiles} onSticker={tapSticker} />
              {empty ? (
                <div className="px-6 pt-8 text-center">
                  <p className="text-[16px] text-wx-ink">{tr('还没有表情', 'No stickers yet')}</p>
                  <p className="mt-2 text-[13px] leading-relaxed text-wx-meta">
                    {tr('点 + 从相册添加，也可以在聊天中长按表情或图片添加', 'Tap + to add from your photos, or long-press a sticker or photo in a chat.')}
                  </p>
                </div>
              ) : null}
            </>
          )}
        </div>

        <input
          ref={inputRef}
          type="file"
          multiple
          accept={STICKER_PICK_ACCEPT}
          tabIndex={-1}
          aria-hidden
          className="hidden"
          onChange={(event) => {
            addPickedStickers(event.target.files, tr);
            event.target.value = '';
          }}
        />
      </div>

      {selecting ? (
        <SelectionBar allSelected={allStickersSelected(items, selected)} count={count} onToggleAll={toggleAll} onFront={moveSelected} onDelete={deleteSelected} />
      ) : null}
    </div>
  );
}
