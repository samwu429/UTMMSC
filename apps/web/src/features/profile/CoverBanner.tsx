import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import type { MemberSelf } from '@utmmsc/shared';
import { errorMessage } from '../../shared/api/errors';
import { useTr } from '../../shared/i18n/locale';
import { documentCanvas, drawScaled, encodeCanvas, releaseCanvas } from '../../shared/media/canvas';
import { cropOutputSize } from '../../shared/media/sizing';
import { useSessionStore } from '../../shared/session/store';
import { ActionSheet } from '../../shared/ui/ActionSheet';
import { Button } from '../../shared/ui/Button';
import { Notice } from '../../shared/ui/Card';
import { profileApi } from './api';
import { coverImageSrc } from './media';
import { Sheet } from './Sheet';

const MOMENTS_HEIGHT = 192;
const PROFILE_HEIGHT = 128;
/**
 * The cover is drawn at most 672 CSS px wide, so 1280px covers a 2x screen. Quality 0.82 keeps a photo near 150KB
 * instead of the 600KB or so of a 1600px JPEG at 0.92.
 * 封面最宽显示 672 CSS px，1280px 足够 2 倍屏。质量 0.82 让一张照片约 150KB，而 1600px、质量 0.92 的 JPEG 约 600KB。
 */
const COVER_WIDTH_MAX = 1280;
const COVER_QUALITY = 0.82;

function bannerWidth(): number {
  return Math.min(window.innerWidth, 672);
}

function clampOffset(x: number, y: number, frameW: number, frameH: number, imageW: number, imageH: number): { x: number; y: number } {
  const maxX = Math.max(0, (imageW - frameW) / 2);
  const maxY = Math.max(0, (imageH - frameH) / 2);
  return { x: Math.min(maxX, Math.max(-maxX, x)), y: Math.min(maxY, Math.max(-maxY, y)) };
}

function placedImage(frameW: number, momentsH: number, naturalW: number, naturalH: number, zoom: number, offsetX: number, offsetY: number): CSSProperties {
  const cover = Math.max(frameW / naturalW, momentsH / naturalH);
  return {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: naturalW * cover * zoom,
    height: naturalH * cover * zoom,
    maxWidth: 'none',
    transform: `translate(calc(-50% + ${offsetX}px), calc(-50% + ${offsetY}px))`,
  };
}

function CoverAdjuster({
  file,
  busy,
  onBack,
  onUse,
}: {
  file: File;
  busy: boolean;
  onBack: () => void;
  onUse: (file: File) => void;
}) {
  const tr = useTr();
  const frameRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [frameW, setFrameW] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  useEffect(() => {
    let cancelled = false;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      setFailed(false);
      setImage(img);
    };
    img.onerror = () => {
      if (!cancelled) setFailed(true);
    };
    img.src = url;
    return () => {
      cancelled = true;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const measure = () => setFrameW(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [image]);

  const momentsH = frameW > 0 ? Math.round(frameW * (MOMENTS_HEIGHT / bannerWidth())) : 0;
  const profileH = frameW > 0 ? Math.round(frameW * (PROFILE_HEIGHT / bannerWidth())) : 0;
  const imageW = image && momentsH > 0 ? image.naturalWidth * Math.max(frameW / image.naturalWidth, momentsH / image.naturalHeight) * zoom : 0;
  const imageH = image && momentsH > 0 ? image.naturalHeight * Math.max(frameW / image.naturalWidth, momentsH / image.naturalHeight) * zoom : 0;

  useEffect(() => {
    if (!image || momentsH <= 0) return;
    setOffset((prev) => {
      const next = clampOffset(prev.x, prev.y, frameW, momentsH, imageW, imageH);
      return next.x === prev.x && next.y === prev.y ? prev : next;
    });
  }, [image, zoom, frameW, momentsH, imageW, imageH]);

  function moveTo(x: number, y: number) {
    setOffset(clampOffset(x, y, frameW, momentsH, imageW, imageH));
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    moveTo(drag.current.ox + event.clientX - drag.current.x, drag.current.oy + event.clientY - drag.current.y);
  }

  function onPointerUp() {
    drag.current = null;
  }

  async function confirm() {
    if (!image || frameW <= 0 || momentsH <= 0) return;
    const cover = Math.max(frameW / image.naturalWidth, momentsH / image.naturalHeight);
    const dw = image.naturalWidth * cover * zoom;
    const dh = image.naturalHeight * cover * zoom;
    const left = (frameW - dw) / 2 + offset.x;
    const top = (momentsH - dh) / 2 + offset.y;
    const sx = Math.max(0, ((0 - left) / dw) * image.naturalWidth);
    const sy = Math.max(0, ((0 - top) / dh) * image.naturalHeight);
    const sw = Math.min((frameW / dw) * image.naturalWidth, image.naturalWidth - sx);
    const sh = Math.min((momentsH / dh) * image.naturalHeight, image.naturalHeight - sy);
    // Drawn in halving steps, so a 12MP photo shrinks smoothly, and never wider than the source pixels it shows.
    // 逐次减半绘制，1200 万像素的照片因此缩得平滑，且宽度不超过它所显示的源像素。
    const canvas = drawScaled(image, { sx, sy, sw, sh }, cropOutputSize(sw, { width: frameW, height: momentsH }, COVER_WIDTH_MAX), documentCanvas);
    if (!canvas) return;
    let blob: Blob | null;
    try {
      blob = await encodeCanvas(canvas, 'image/jpeg', COVER_QUALITY);
    } finally {
      releaseCanvas(canvas);
    }
    if (!blob) return;
    onUse(new File([blob], 'cover.jpg', { type: 'image/jpeg' }));
  }

  const style = image && momentsH > 0 ? placedImage(frameW, momentsH, image.naturalWidth, image.naturalHeight, zoom, offset.x, offset.y) : undefined;

  return (
    <div className="space-y-3">
      <p className="text-sm leading-relaxed text-stone-500">
        {tr('拖动照片，选择露在封面里的部分。上面是动态页，下面是资料页。', 'Drag the photo to choose what shows in the cover. The top frame is the updates page, the bottom one is your profile.')}
      </p>
      {failed ? <Notice tone="error">{tr('这张照片打不开，请换一张。', 'This photo could not be opened. Choose another one.')}</Notice> : null}
      <div>
        <p className="mb-1 text-xs text-stone-400">{tr('动态', 'Updates')}</p>
        <div
          ref={frameRef}
          className="relative w-full touch-none overflow-hidden rounded-lg bg-stone-200 ring-1 ring-stone-300"
          style={{ height: momentsH || 160 }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {image && style ? <img src={image.src} alt="" draggable={false} style={style} /> : null}
        </div>
      </div>
      {/* The profile strip is the vertical middle of the moments strip, same as object-cover on the saved photo. */}
      {/* 资料页那条是动态页那条的纵向中间，和保存后页面上的裁切一致。 */}
      <div>
        <p className="mb-1 text-xs text-stone-400">{tr('资料', 'Profile')}</p>
        <div className="relative w-full overflow-hidden rounded-lg bg-stone-200 ring-1 ring-stone-300" style={{ height: profileH || 96 }}>
          {image && style ? <img src={image.src} alt="" draggable={false} style={style} /> : null}
        </div>
      </div>
      <label className="block text-sm text-stone-600">
        {tr('缩放', 'Zoom')}
        <input
          type="range"
          min={1}
          max={3}
          step={0.01}
          value={zoom}
          onChange={(event) => setZoom(Number(event.target.value))}
          className="mt-1 w-full"
        />
      </label>
      <Button block disabled={!image || failed} loading={busy} onClick={() => void confirm()}>
        {tr('使用这张', 'Use this photo')}
      </Button>
      <Button block variant="secondary" disabled={busy} onClick={onBack}>
        {tr('重选', 'Choose another')}
      </Button>
    </div>
  );
}

/**
 * The tall cover's picture reaches up by --pull (set by the moments pull to refresh), so a pull or the iPhone
 * bounce shows more of the cover instead of a gap above it. Elsewhere the variable is unset and it stays put.
 * 高封面的图片向上延伸 --pull（由动态页的下拉刷新设置），下拉或 iPhone 回弹时露出更多封面，而不是上方的空白。其他地方没有设置这个变量，图片保持不动。
 */
const STRETCH_UP: CSSProperties = { top: 'calc(-1 * var(--pull, 0px))' };
const FLUSH: CSSProperties = { top: 0 };

export function CoverBanner({
  coverKey,
  tall = false,
  editable = false,
  editTrigger = 'button',
  onSaved,
  children,
}: {
  coverKey?: string | null;
  tall?: boolean;
  editable?: boolean;
  /**
   * button: a 换封面 button on the cover. cover: the whole cover is the control and offers 更换相册封面 in an
   * action sheet first, as on WeChat's moments page; children stay above it and keep their own taps.
   * button：封面上显示「换封面」按钮。cover：整个封面就是控件，先在操作菜单中提供「更换相册封面」，与微信朋友圈一致；
   * children 位于其上方，保留各自的点按。
   */
  editTrigger?: 'button' | 'cover';
  onSaved?: (member: MemberSelf) => void;
  children?: ReactNode;
}) {
  const tr = useTr();
  const token = useSessionStore((s) => s.mediaToken);
  const setMember = useSessionStore((s) => s.setMember);
  const setMediaToken = useSessionStore((s) => s.setMediaToken);
  const [choosing, setChoosing] = useState(false);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const src = coverImageSrc(coverKey, token);

  function saved(member: MemberSelf, mediaToken?: string) {
    setMember(member);
    if (mediaToken) setMediaToken(mediaToken);
    onSaved?.(member);
    setDraft(null);
    setOpen(false);
  }

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const res = await profileApi.uploadCover(file);
      saved(res.member, res.mediaToken);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function clear() {
    setBusy(true);
    setError(null);
    try {
      const res = await profileApi.removeCover();
      saved(res.member);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function close() {
    if (busy) return;
    setDraft(null);
    setError(null);
    setOpen(false);
  }

  return (
    <div className={`relative ${tall ? 'h-48' : 'h-32'}`}>
      <div className="absolute inset-x-0 bottom-0 overflow-hidden bg-brand-800" style={tall ? STRETCH_UP : FLUSH}>
        <div className="relative z-10 h-1 bg-gold" />
        {src ? <img src={src} alt="" draggable={false} decoding="async" className="absolute inset-0 h-full w-full object-cover [-webkit-touch-callout:none]" /> : null}
      </div>
      {src ? <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/45 to-transparent" /> : null}
      {editable && editTrigger === 'cover' ? (
        <button
          type="button"
          onClick={() => setChoosing(true)}
          aria-label={tr('更换相册封面', 'Change album cover')}
          aria-haspopup="dialog"
          className="absolute inset-0 select-none [-webkit-touch-callout:none] focus-visible:outline-offset-[-4px]"
        />
      ) : null}
      {children}
      {choosing ? (
        <ActionSheet
          options={[{ label: tr('更换相册封面', 'Change album cover'), onSelect: () => setOpen(true) }]}
          onClose={() => setChoosing(false)}
        />
      ) : null}
      {editable && editTrigger === 'button' ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`absolute z-10 inline-flex min-h-9 items-center rounded-full bg-black/40 px-3 text-sm font-medium text-white ${tall ? 'left-3 top-3' : 'right-3 top-3'}`}
        >
          {tr('换封面', 'Change cover')}
        </button>
      ) : null}
      {open ? (
        <Sheet title={draft ? tr('调整封面', 'Adjust cover') : tr('封面', 'Cover')} onClose={close}>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) setDraft(file);
              if (inputRef.current) inputRef.current.value = '';
            }}
          />
          {draft ? (
            <div className="space-y-3">
              {error ? <Notice tone="error">{error}</Notice> : null}
              <CoverAdjuster file={draft} busy={busy} onBack={() => setDraft(null)} onUse={(next) => void upload(next)} />
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm leading-relaxed text-stone-500">
                {tr('选完照片后可以先拖动，确认露出的部分，再放到资料页和动态页顶部。', 'After choosing a photo, drag it to set what shows before it goes at the top of your profile and updates page.')}
              </p>
              {error ? <Notice tone="error">{error}</Notice> : null}
              <Button block onClick={() => inputRef.current?.click()} loading={busy}>
                {tr('选择照片', 'Choose photo')}
              </Button>
              {coverKey ? (
                <Button block variant="secondary" disabled={busy} onClick={() => void clear()}>
                  {tr('恢复默认', 'Restore default')}
                </Button>
              ) : null}
            </div>
          )}
        </Sheet>
      ) : null}
    </div>
  );
}
