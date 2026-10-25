import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { CHANNEL_ICON_PRESETS, type ChannelIconPresetId } from '@utmmsc/shared';
import { useTr } from '../../../shared/i18n/locale';
import { useBackToClose } from '../../../shared/ui/overlayHistory';
import { WxSpinner } from '../../../shared/ui/WxSpinner';
import { presetChannelIconUrl } from '../list/channelIconSrc';

export interface PresetIconSheetProps {
  /** The preset the channel uses now, ringed in gold. */
  /** 频道当前使用的预设，带金色外圈。 */
  selected: ChannelIconPresetId | null;
  /** The preset being saved, which shows a spinner while the others wait. */
  /** 正在保存的预设，显示加载动画，其他预设暂不可选。 */
  busy: ChannelIconPresetId | null;
  /** A tap saves at once; the caller closes the sheet once the server has it. */
  /** 点按即保存；服务器保存后由调用方关闭弹出层。 */
  onPick: (id: ChannelIconPresetId) => void;
  onClose: () => void;
}

/**
 * 选择预设图标: the eight bundled icons in a 4-column grid of 64 px tiles with their names. The selected one has a gold
 * ring; a tap saves it. A bottom sheet on phones, a centred card on desktop; back, Esc and a tap outside close it.
 * 「选择预设图标」：八个内置图标，4 列网格，每格 64px 并带名称。已选的一个带金色外圈；点按即保存。手机上是底部弹出层，桌面上是居中的卡片；
 * 返回、Esc 和点按外部都会关闭。
 */
export function PresetIconSheet({ selected, busy, onPick, onClose }: PresetIconSheetProps) {
  const tr = useTr();
  const closeRef = useRef(onClose);
  const pressStartedOnBackdrop = useRef(false);
  const tileRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // Focus goes to the chosen tile once, when the sheet opens.
  // 只在弹出层打开时把焦点放到已选的图标上一次。
  const [firstFocus] = useState(() => Math.max(0, CHANNEL_ICON_PRESETS.findIndex((preset) => preset.id === selected)));
  useLayoutEffect(() => {
    closeRef.current = onClose;
  });
  useBackToClose(onClose);

  useEffect(() => {
    tileRefs.current[firstFocus]?.focus({ preventScroll: true });
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [firstFocus]);

  // Arrow keys move around the grid, four to a row.
  // 方向键在网格中移动，每行四个。
  function onTileKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const count = CHANNEL_ICON_PRESETS.length;
    const moves: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 4, ArrowUp: -4 };
    const move = moves[event.key];
    if (move === undefined) return;
    event.preventDefault();
    const next = Math.min(count - 1, Math.max(0, index + move));
    tileRefs.current[next]?.focus();
  }

  return createPortal(
    <div
      className="wx-fade fixed inset-0 z-[62] flex items-end justify-center bg-black/40 lg:items-center lg:p-6"
      onPointerDown={(event) => {
        pressStartedOnBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && pressStartedOnBackdrop.current) onClose();
        pressStartedOnBackdrop.current = false;
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={tr('选择预设图标', 'Choose a preset icon')}
        className="wx-slide-up w-full max-w-2xl rounded-t-2xl bg-white px-4 pt-3 lg:max-w-md lg:rounded-2xl lg:px-6 lg:pt-5"
        style={{ paddingBottom: 'max(1.25rem, var(--safe-bottom))' }}
      >
        <div aria-hidden className="mx-auto mb-3 h-1 w-10 rounded-full bg-stone-200 lg:hidden" />
        <div className="flex items-center">
          <h2 className="flex-1 text-[17px] font-semibold text-brand-800">{tr('选择预设图标', 'Choose a preset icon')}</h2>
          <button type="button" onClick={onClose} className="-mr-2 min-h-11 rounded-lg px-3 text-[15px] text-stone-600 active:bg-stone-100">
            {tr('取消', 'Cancel')}
          </button>
        </div>
        <div role="radiogroup" aria-label={tr('预设图标', 'Preset icons')} aria-busy={busy !== null || undefined} className="mt-3 grid grid-cols-4 gap-x-2 gap-y-4 pb-2">
          {CHANNEL_ICON_PRESETS.map((preset, index) => {
            const checked = preset.id === selected;
            const saving = preset.id === busy;
            const held = busy !== null && !saving;
            return (
              <button
                key={preset.id}
                ref={(element) => {
                  tileRefs.current[index] = element;
                }}
                type="button"
                role="radio"
                aria-checked={checked}
                aria-disabled={held || undefined}
                onClick={() => {
                  if (busy === null && !checked) onPick(preset.id);
                  else if (busy === null && checked) onClose();
                }}
                onKeyDown={(event) => onTileKey(event, index)}
                className={`flex min-h-11 flex-col items-center gap-1.5 rounded-lg py-1 outline-offset-2 ${held ? 'opacity-50' : 'active:bg-stone-100'}`}
              >
                <span className={`relative block h-16 w-16 overflow-hidden rounded-[6px] ${checked ? 'ring-[3px] ring-gold ring-offset-2' : 'ring-1 ring-black/[0.06]'}`}>
                  <img src={presetChannelIconUrl(preset.id)} alt="" width={64} height={64} draggable={false} decoding="async" className="h-16 w-16" />
                  {saving ? (
                    <span className="absolute inset-0 flex items-center justify-center bg-white/70">
                      <WxSpinner label={tr('正在保存', 'Saving')} />
                    </span>
                  ) : null}
                </span>
                <span className="max-w-full truncate text-[13px] leading-4 text-stone-700">{tr(preset.zh, preset.en)}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
