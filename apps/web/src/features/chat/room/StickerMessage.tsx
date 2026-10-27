import { useCallback, useEffect, useState } from 'react';
import type { StickerRef } from '@utmmsc/shared';
import { useTr } from '../../../shared/i18n/locale';
import { useReducedMotion } from '../../../shared/media/reducedMotion';
import { useSessionStore } from '../../../shared/session/store';
import type { LongPressHandlers } from '../../../shared/ui/useLongPress';
import { mediaStatus, saveDataPreferred, stickerAutoplays, stickerChatImage, stickerFileSrc, stickerThumbSrc } from '../stickers/media';
import { useStickerPlayback } from '../stickers/playback';
import { StickerPlayMark } from './messageIcons';
import { fitSticker, STICKER_LOAD_START, stickerAttemptSrc, stickerLoadStep, type StickerLoadEvent, type StickerLoadPhase, type StickerLoadState } from './stickerBox';

/** A failure tile never gets smaller than this, so its words fit even for a tiny sticker. */
/** 失败图块不小于这个尺寸，即使表情很小，文字也放得下。 */
const FAILURE_MIN_WIDTH = 96;
const FAILURE_MIN_HEIGHT = 56;

export interface StickerSource {
  /** The address of the current attempt, or null when there is nothing to load. */
  /** 当前这次尝试的地址；没有可加载的内容时为 null。 */
  src: string | null;
  phase: StickerLoadPhase;
  /** Nothing has loaded in this element yet, so a placeholder sits behind the image. */
  /** 这个元素中还没有加载成功过任何图片，因此图片后面垫着占位块。 */
  fresh: boolean;
  onLoad(): void;
  onError(): void;
  /** A tap on a failed sticker: load it again. */
  /** 点按加载失败的表情：重新加载。 */
  retry(): void;
}

/**
 * Loading one sticker image with the failure steps of 1.4, kept per image (`identity`), so switching between the file
 * and the still and back does not start over. After two failures the file's address (`probeSrc`) is asked whether it
 * still exists; `still` says the failed image was the still, whose file may be fine.
 * 按 1.4 的失败步骤加载一张表情图片，状态按图片（`identity`）分别保存，在文件和静态图之间来回切换时不会从头开始。
 * 两次失败后向文件地址（`probeSrc`）确认它是否仍然存在；`still` 表示失败的是静态图，它的文件可能完好。
 */
export function useStickerSource(identity: string, base: string | null, probeSrc: string | null, still: boolean): StickerSource {
  const [states, setStates] = useState<Record<string, StickerLoadState>>({});
  const state = states[identity] ?? STICKER_LOAD_START;

  const dispatch = useCallback(
    (event: StickerLoadEvent) => {
      setStates((prev) => {
        const current = prev[identity] ?? STICKER_LOAD_START;
        const next = stickerLoadStep(current, event);
        return next === current ? prev : { ...prev, [identity]: next };
      });
    },
    [identity],
  );

  const probing = state.phase === 'probing';
  useEffect(() => {
    if (!probing) return;
    let cancelled = false;
    if (!probeSrc) {
      dispatch({ type: 'probed', status: null, still });
      return;
    }
    void mediaStatus(probeSrc).then((status) => {
      if (!cancelled) dispatch({ type: 'probed', status, still });
    });
    return () => {
      cancelled = true;
    };
  }, [probing, probeSrc, still, dispatch]);

  return {
    src: base ? stickerAttemptSrc(base, state.retry) : null,
    phase: state.phase,
    fresh: !Object.values(states).some((entry) => entry.phase === 'shown'),
    onLoad: () => dispatch({ type: 'loaded' }),
    onError: () => dispatch({ type: 'error' }),
    retry: () => dispatch({ type: 'tap' }),
  };
}

interface Props {
  sticker: StickerRef;
  /** Who this sticker is to the chat's playback limit: the message id, or the pending send's own key. */
  /** 这个表情在聊天播放上限中的身份：消息 id，或待发消息自己的键。 */
  playKey: string;
  /** Higher plays first: the message id, the newest rank for a pending send. */
  /** 越高越先播放：消息 id；待发消息取最新的名次。 */
  rank: number;
  pressed?: boolean;
  handlers?: LongPressHandlers;
  /** The tap preview; absent for a pending send. */
  /** 点按预览；待发消息没有。 */
  onOpen?: () => void;
}

/**
 * A sticker in the chat: no bubble and no background, fitted into 150 x 150 (never more than twice its size) inside a
 * tap area of at least 48 x 48 reserved from the stored size, so nothing shifts when it loads. An animated sticker
 * that may play (1.4) plays while it is among the newest 8 on screen and shows its still otherwise; one that may not
 * shows its still with the play mark, and its preview plays it. A failed load is retried once silently; then
 * 「这个表情已失效」 if the file is really gone, else 「加载失败，点按重试」.
 * 聊天中的表情：没有气泡也没有背景，按保存的尺寸放入 150 x 150（不超过自身尺寸的两倍），点按区域至少 48 x 48，加载时不会跳动。
 * 允许播放的动态表情（1.4）在属于屏幕上最新的 8 个时播放，否则显示静态图；不允许播放的显示带播放标记的静态图，由预览来播放。
 * 加载失败会静默重试一次；之后若文件确实已不存在则显示「这个表情已失效」，否则显示「加载失败，点按重试」。
 */
export function StickerMessage({ sticker, playKey, rank, pressed = false, handlers, onOpen }: Props) {
  const tr = useTr();
  const token = useSessionStore((s) => s.mediaToken);
  const reducedMotion = useReducedMotion();
  const [saveData] = useState(saveDataPreferred);
  const options = { reducedMotion, saveData };
  const autoplays = stickerAutoplays(sticker, options);
  const playback = useStickerPlayback(playKey, rank, autoplays, 'chat');
  const fit = fitSticker(sticker.width, sticker.height);

  // A sticker that may play but is not among those playing now shows its still meanwhile, without the play mark: it
  // moves again once it is its turn, and the mark would flash on every chat's first frame.
  // 可以播放、但目前不在播放名额之内的表情暂时显示静态图，不带播放标记：轮到它时就会再动起来，而且标记会在每个聊天的第一帧闪一下。
  const chosen = stickerChatImage(sticker, token, options);
  const waiting = sticker.animated && autoplays && !playback.playing;
  const still = chosen.still || waiting;
  const marked = chosen.still;
  const base = waiting ? stickerThumbSrc(sticker, token) : chosen.src;
  const identity = still ? `still:${sticker.id}:${sticker.thumb ?? ''}` : `file:${sticker.id}`;
  const load = useStickerSource(identity, base, stickerFileSrc(sticker, token), still);

  const gone = load.phase === 'gone';
  const failed = load.phase === 'failed';
  // A still that is broken while its file is fine is drawn like a sticker without a still.
  // 静态图损坏而文件完好时，按没有静态图的表情绘制。
  const src = load.phase === 'stillBroken' ? null : load.src;

  let label: string;
  if (gone) label = tr('这个表情已失效', 'This sticker is no longer available.');
  else if (failed) label = tr('加载失败，点按重试', "Couldn't load. Tap to retry.");
  else if (!sticker.animated) label = tr('表情', 'Sticker');
  // A pending send has no preview yet, so it does not invite a tap.
  // 待发消息还没有预览，因此不提示点按。
  else if (marked && onOpen) label = tr('动画表情，点按播放', 'Animated sticker. Tap to play.');
  else label = tr('动画表情', 'Animated sticker');

  const broken = gone || failed;
  const width = broken ? Math.max(fit.boxWidth, FAILURE_MIN_WIDTH) : fit.boxWidth;
  const height = broken ? Math.max(fit.boxHeight, FAILURE_MIN_HEIGHT) : fit.boxHeight;

  function onClick() {
    if (failed) load.retry();
    else if (!gone) onOpen?.();
  }

  return (
    <button
      ref={playback.ref}
      type="button"
      className={`relative flex shrink-0 select-none items-center justify-center rounded-[6px] ${pressed && !broken ? 'bg-black/5' : ''}`}
      style={{ width, height, WebkitTouchCallout: 'none', touchAction: 'manipulation' }}
      aria-label={label}
      data-interactive
      onClick={onClick}
      {...handlers}
    >
      {broken ? (
        // quoteInk, not meta: meta text stays under 4.5:1 on this gray.
        // 用 quoteInk 而不是 meta：meta 文字在这种灰底上达不到 4.5:1。
        <span className="flex h-full w-full items-center justify-center rounded-[6px] bg-wx-line px-1.5 text-center text-xs leading-4 text-wx-quoteInk" aria-hidden>
          {label}
        </span>
      ) : (
        <span className="pointer-events-none relative block" style={{ width: fit.width, height: fit.height }} aria-hidden>
          {!src || (load.fresh && load.phase !== 'shown') ? <span className="absolute inset-0 rounded-[6px] bg-wx-line/60" /> : null}
          {src ? (
            <img
              src={src}
              alt=""
              width={fit.width}
              height={fit.height}
              draggable={false}
              loading="lazy"
              decoding="async"
              onLoad={load.onLoad}
              onError={load.onError}
              className="absolute inset-0 h-full w-full object-contain"
            />
          ) : null}
          {marked ? (
            <span className="absolute inset-0 flex items-center justify-center">
              <StickerPlayMark />
            </span>
          ) : null}
        </span>
      )}
    </button>
  );
}
