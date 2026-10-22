import { useSyncExternalStore, type ReactNode } from 'react';

const TICK_MS = 60_000;

let tickNow = Date.now();
let tickTimer: ReturnType<typeof setTimeout> | null = null;
const tickListeners = new Set<() => void>();

function scheduleTick() {
  // Aligned to the next whole minute, so every label changes together with the clock.
  // 对齐到下一个整分钟，所有时间文字与时钟同步变化。
  tickTimer = setTimeout(() => {
    tickNow = Date.now();
    for (const listener of tickListeners) listener();
    scheduleTick();
  }, TICK_MS - (Date.now() % TICK_MS) + 50);
}

function subscribeTick(listener: () => void): () => void {
  tickListeners.add(listener);
  if (!tickTimer) {
    tickNow = Date.now();
    scheduleTick();
  }
  return () => {
    tickListeners.delete(listener);
    if (tickListeners.size === 0 && tickTimer) {
      clearTimeout(tickTimer);
      tickTimer = null;
    }
  };
}

function readTick(): number {
  return tickNow;
}

/**
 * One timer shared by every subscriber that fires each minute, so time labels and expiring tip
 * actions such as 重新编辑 refresh without a timer per row.
 * 所有订阅者共用、每分钟触发一次的计时器，时间文字和会过期的提示操作（如“重新编辑”）因此无需每行各开一个计时器。
 */
export function useMinuteTick(): number {
  return useSyncExternalStore(subscribeTick, readTick, readTick);
}

function TipLine({ children }: { children: ReactNode }) {
  return <p className="mx-auto max-w-[80%] break-words text-center text-[13px] leading-[18px] text-wx-meta">{children}</p>;
}

/** Centred gray tip such as a recall or join notice, with an optional link-style action. */
/** 居中的灰色提示，例如撤回或入群提示，可附带一个链接样式的操作。 */
export function SystemTip({ text, action }: { text: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="px-3 py-3">
      <TipLine>
        {text}
        {action ? (
          <>
            {' '}
            <button
              type="button"
              onClick={action.onClick}
              className="relative text-wx-link before:absolute before:left-1/2 before:top-1/2 before:h-11 before:w-full before:min-w-11 before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']"
            >
              {action.label}
            </button>
          </>
        ) : null}
      </TipLine>
    </div>
  );
}

export function TimeDivider({ text }: { text: string }) {
  return (
    <div className="px-3 py-3">
      <TipLine>{text}</TipLine>
    </div>
  );
}

/** 「以下为新消息」 line placed above the first unread message. */
/** 放在第一条未读消息上方的「以下为新消息」分隔线。 */
export function UnreadMarker({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 px-8 py-3 text-[13px] leading-[18px] text-wx-meta" role="separator" aria-label={label}>
      <span className="h-px flex-1 bg-wx-line" aria-hidden />
      <span aria-hidden>{label}</span>
      <span className="h-px flex-1 bg-wx-line" aria-hidden />
    </div>
  );
}
