import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { MomentAudience, MomentAudienceCounts } from '@utmmsc/shared';
import { useTr } from '../../../shared/i18n/locale';
import { useBackToClose } from '../../../shared/ui/overlayHistory';
import { OVERLAY_BOTTOM_INSET, useVisualViewportOverlay } from '../../chat/room/useVisualViewport';
import { momentsApi } from '../api';
import { FriendsIcon, GlobeIcon, LockIcon } from '../icons';

/* The bottom sheet both composer sheets use */
/* 编辑器两个底部面板共用的外框 */

export interface ComposerSheetProps {
  title: string;
  onClose(): void;
  /** Rendered at the right of the title row, such as 完成. */
  /** 显示在标题行右侧，例如「完成」。 */
  trailing?: ReactNode;
  children: ReactNode;
}

/**
 * The composer's bottom sheet: a dimmed backdrop, the title between 取消 and an optional action, and a list
 * that scrolls inside. It is pinned to the visual viewport, so with the keyboard up it sits right above it;
 * back, Escape and a tap on the backdrop close it, and Tab stays inside while it is open.
 * 编辑器的底部面板：变暗的遮罩、位于「取消」与可选操作之间的标题，以及在面板内滚动的列表。面板固定在可见视口上，键盘弹出时紧贴键盘上方；
 * 返回、Escape 和轻触遮罩都会关闭它，打开期间 Tab 停留在面板内。
 */
export function ComposerSheet({ title, onClose, trailing, children }: ComposerSheetProps) {
  const tr = useTr();
  const titleId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const pressStartedOnBackdrop = useRef(false);
  const [trigger] = useState<Element | null>(() => (typeof document === 'undefined' ? null : document.activeElement));

  useLayoutEffect(() => {
    closeRef.current = onClose;
  });

  useVisualViewportOverlay(rootRef);
  useBackToClose(onClose);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    // A field inside may have taken focus in its own layout effect already; keep it.
    // 面板内的输入框可能已在自己的布局副作用中获得焦点；保留它。
    if (panel && !panel.contains(document.activeElement)) panel.focus({ preventScroll: true });
    return () => {
      if (!(trigger instanceof HTMLElement) || trigger === document.body || !trigger.isConnected) return;
      // On touch screens, refocusing a text field would bring the keyboard back up after the sheet closes.
      // 在触屏上，重新聚焦输入框会在面板关闭后再次弹出键盘。
      const textField = trigger instanceof HTMLTextAreaElement || trigger instanceof HTMLInputElement;
      if (textField && window.matchMedia?.('(pointer: coarse)').matches) return;
      trigger.focus({ preventScroll: true });
    };
  }, [trigger]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])'));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return createPortal(
    <div
      ref={rootRef}
      className="wx-fade fixed inset-x-0 top-0 z-[60] flex h-[100dvh] touch-none flex-col justify-end bg-black/40"
      onPointerDown={(event) => {
        pressStartedOnBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        // Only a tap that both starts and ends on the backdrop dismisses.
        // 只有在遮罩上按下并松开的点按才会关闭。
        if (event.target === event.currentTarget && pressStartedOnBackdrop.current) onClose();
        pressStartedOnBackdrop.current = false;
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="wx-slide-up mx-auto flex max-h-[85%] w-full max-w-2xl flex-col overflow-hidden rounded-t-xl bg-white outline-none"
        style={{ paddingLeft: 'var(--safe-left)', paddingRight: 'var(--safe-right)' }}
      >
        <div className="relative flex h-14 shrink-0 items-center justify-between border-b-[0.5px] border-wx-line px-1">
          <button type="button" onClick={onClose} className="min-h-11 min-w-11 px-3 text-[17px] text-wx-ink active:opacity-60">
            {tr('取消', 'Cancel')}
          </button>
          <h2 id={titleId} className="pointer-events-none absolute inset-x-20 truncate text-center text-[17px] font-medium text-wx-ink">
            {title}
          </h2>
          <div className="flex min-w-11 justify-end">{trailing}</div>
        </div>
        <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain" style={{ paddingBottom: OVERLAY_BOTTOM_INSET }}>
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** The check mark of the chosen row. */
/** 已选中行的对勾。 */
export function CheckMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-brand-700" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

/* Who can see */
/* 谁可以看 */

/** Kept for the session, so a second open shows the counts at once while they refresh. */
/** 在本次会话中保留，再次打开时立即显示人数，同时在后台刷新。 */
let lastCounts: MomentAudienceCounts | null = null;
let inFlight: Promise<MomentAudienceCounts> | null = null;

/**
 * How many members each audience reaches, from GET /moments/audience: the last answer at once, then a fresh
 * one. Null until the first answer, and when it fails, so the sheet shows the labels without numbers.
 * 每种可见范围能触达的人数，来自 GET /moments/audience：先显示上次的结果，再取新的。首次返回之前和请求失败时为 null，面板只显示不带人数的选项。
 */
export function useAudienceCounts(): MomentAudienceCounts | null {
  const [counts, setCounts] = useState<MomentAudienceCounts | null>(lastCounts);
  useEffect(() => {
    let active = true;
    inFlight ??= Promise.resolve()
      .then(() => momentsApi.audience())
      .finally(() => {
        inFlight = null;
      });
    inFlight
      .then((next) => {
        lastCounts = next;
        if (active) setCounts(next);
      })
      .catch(() => {
        // Counts are extra information; the options work without them.
        // 人数只是附加信息；没有人数时选项照常可用。
      });
    return () => {
      active = false;
    };
  }, []);
  return counts;
}

type Translate = (zh: string, en: string) => string;

/** 好友（23人）, 全社团（180人）, 仅自己; without a number before the counts arrive. */
/** 好友（23人）、全社团（180人）、仅自己；人数返回之前不带数字。 */
export function audienceLabel(audience: MomentAudience, counts: MomentAudienceCounts | null, tr: Translate): string {
  if (audience === 'friends') return counts ? tr(`好友（${counts.friends}人）`, `Friends (${counts.friends})`) : tr('好友', 'Friends');
  if (audience === 'club') return counts ? tr(`全社团（${counts.club}人）`, `Whole club (${counts.club})`) : tr('全社团', 'Whole club');
  return tr('仅自己', 'Only me');
}

/** The short value the composer row shows. */
/** 编辑器的行上显示的简短取值。 */
export function audienceShortLabel(audience: MomentAudience, tr: Translate): string {
  if (audience === 'friends') return tr('好友', 'Friends');
  if (audience === 'club') return tr('全社团', 'Whole club');
  return tr('仅自己', 'Only me');
}

export function audienceDescription(audience: MomentAudience, tr: Translate): string {
  if (audience === 'friends') return tr('只有你的好友能看到；每个人只看得到共同好友的赞和评论', 'Only your friends see it; each sees likes and comments from friends you share');
  if (audience === 'club') return tr('所有在用成员都能看到，赞和评论也对所有人可见', 'Every member can see it, along with its likes and comments');
  return tr('只有你自己能看到', 'Only you can see it');
}

export function AudienceIcon({ audience, className = 'h-5 w-5' }: { audience: MomentAudience; className?: string }) {
  if (audience === 'club') return <GlobeIcon className={className} />;
  if (audience === 'private') return <LockIcon className={className} />;
  return <FriendsIcon className={className} />;
}

const ORDER: readonly MomentAudience[] = ['friends', 'club', 'private'];

export interface AudienceSheetProps {
  value: MomentAudience;
  onChange(audience: MomentAudience): void;
  onClose(): void;
}

/**
 * 谁可以看: 好友, 全社团 and 仅自己 with their reach and what each means for likes and comments. Choosing one
 * closes the sheet. The composer starts at 好友 every time.
 * 谁可以看：好友、全社团和仅自己，附带触达人数以及各自对赞和评论的含义。选择后面板关闭。编辑器每次都从「好友」开始。
 */
export function AudienceSheet({ value, onChange, onClose }: AudienceSheetProps) {
  const tr = useTr();
  const counts = useAudienceCounts();
  return (
    <ComposerSheet title={tr('谁可以看', 'Who can see')} onClose={onClose}>
      <div role="radiogroup" aria-label={tr('谁可以看', 'Who can see')}>
        {ORDER.map((audience, index) => {
          const selected = audience === value;
          return (
            <button
              key={audience}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => {
                onChange(audience);
                onClose();
              }}
              className="flex w-full items-center gap-3 bg-white pl-4 text-left active:bg-wx-pressed"
            >
              <span className={`shrink-0 ${selected ? 'text-brand-700' : 'text-wx-meta'}`}>
                <AudienceIcon audience={audience} className="h-6 w-6" />
              </span>
              <span className={`flex min-h-[4.5rem] min-w-0 flex-1 items-center gap-3 py-3 pr-4 ${index > 0 ? 'border-t-[0.5px] border-wx-line' : ''}`}>
                <span className="min-w-0 flex-1">
                  <span className="block text-[17px] leading-snug text-wx-ink">{audienceLabel(audience, counts, tr)}</span>
                  <span className="mt-0.5 block text-[13px] leading-snug text-wx-meta">{audienceDescription(audience, tr)}</span>
                </span>
                {selected ? <CheckMark /> : <span className="h-5 w-5 shrink-0" aria-hidden />}
              </span>
            </button>
          );
        })}
      </div>
    </ComposerSheet>
  );
}
