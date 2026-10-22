import { useEffect, useLayoutEffect, useRef } from 'react';

/** The parts of window.history the overlay entries use, so the logic runs without a browser. */
/** 浮层历史记录所用的 window.history 功能，使逻辑可以脱离浏览器运行。 */
export interface HistoryPort {
  readState(): unknown;
  /** Adds an entry for the same URL on top of the current one. */
  /** 在当前记录之上为同一 URL 添加一条记录。 */
  pushState(state: unknown): void;
  go(delta: number): void;
  onPop(listener: () => void): void;
  /** Runs a task after the current one, once callers have had the chance to navigate. */
  /** 在当前任务之后执行，调用方此前已有机会完成跳转。 */
  later(task: () => void): void;
}

const MARK = 'wxOverlay';

interface Mark {
  /** History state survives a reload, so marks from an earlier page load are told apart and ignored. */
  /** 历史状态在重新加载后仍然保留，因此要区分并忽略之前页面加载留下的标记。 */
  page: string;
  id: number;
}

function readMark(state: unknown, page: string): number | null {
  if (!state || typeof state !== 'object') return null;
  const value = (state as Record<string, unknown>)[MARK];
  if (!value || typeof value !== 'object') return null;
  const mark = value as Partial<Mark>;
  return mark.page === page && typeof mark.id === 'number' ? mark.id : null;
}

interface Entry {
  id: number;
  close: () => void;
  open: boolean;
  pushed: boolean;
}

/**
 * History entries for full-screen overlays, so the system back gesture closes the top overlay instead of
 * leaving the page. Each open overlay owns one entry that copies the router's state and adds a mark.
 * Closing an overlay by its own controls pops its entry, but only while that entry is still the current
 * one: a navigation from the overlay keeps the entry, and a later back skips it. Pushes and pops wait for
 * the current task to end, so StrictMode's extra mount pushes nothing and a navigation right after a close
 * is never undone.
 * 全屏浮层的历史记录，系统返回手势因此关闭最上层的浮层，而不是离开页面。每个打开的浮层拥有一条记录，复制路由的状态并加上标记。
 * 通过浮层自身的控件关闭时会弹出其记录，但仅当该记录仍是当前记录时：从浮层发起的跳转会保留这条记录，之后的返回会跳过它。
 * 压入和弹出都等到当前任务结束后进行，因此 StrictMode 的额外挂载不会压入任何记录，关闭后紧接着的跳转也不会被撤销。
 */
export class OverlayHistory {
  /** Entries pushed and still believed to be in the browser history, oldest first. */
  /** 已压入且仍认为在浏览器历史中的记录，按从旧到新排列。 */
  private entries: Entry[] = [];
  /** Overlays opened whose entry is not pushed yet. */
  /** 已打开但尚未压入记录的浮层。 */
  private waiting: Entry[] = [];
  private seq = 0;
  /** Traversals this class started whose popstate has not arrived yet. */
  /** 本类发起、尚未收到 popstate 的历史跳转数。 */
  private ownPops = 0;
  private flushQueued = false;
  private listening = false;

  constructor(
    private readonly port: HistoryPort,
    private readonly page: string = Math.random().toString(36).slice(2),
  ) {}

  private current(): number | null {
    return readMark(this.port.readState(), this.page);
  }

  /** Registers an open overlay; the returned function is called when it closes by any other means. */
  /** 登记一个打开的浮层；以其他方式关闭时调用返回的函数。 */
  open(close: () => void): () => void {
    if (!this.listening) {
      this.listening = true;
      this.port.onPop(() => this.onPop());
    }
    const entry: Entry = { id: ++this.seq, close, open: true, pushed: false };
    this.waiting.push(entry);
    this.queueFlush();
    return () => this.release(entry);
  }

  private release(entry: Entry): void {
    if (!entry.open) return;
    entry.open = false;
    if (!entry.pushed) {
      this.waiting = this.waiting.filter((e) => e !== entry);
      return;
    }
    this.queueFlush();
  }

  private queueFlush(): void {
    if (this.flushQueued) return;
    this.flushQueued = true;
    this.port.later(() => {
      this.flushQueued = false;
      this.flush();
    });
  }

  private flush(): void {
    // A push before an earlier traversal lands would be undone by it, so everything waits for its popstate.
    // 在先前的跳转完成之前压入的记录会被它撤销，因此一切都等到其 popstate 到达后再进行。
    if (this.ownPops > 0) return;
    if (this.popClosed()) return;
    for (const entry of this.waiting) {
      const base = this.port.readState();
      const mark: Mark = { page: this.page, id: entry.id };
      this.port.pushState({ ...(base && typeof base === 'object' ? base : {}), [MARK]: mark });
      entry.pushed = true;
      this.entries.push(entry);
    }
    this.waiting = [];
  }

  /** Pops closed entries at the top of the history in one traversal; returns true when one started. */
  /** 用一次跳转弹出历史顶部已关闭的记录；发起了跳转时返回 true。 */
  private popClosed(): boolean {
    const current = this.current();
    const index = this.entries.findIndex((e) => e.id === current);
    // Not on one of these entries: a navigation went on top of them, so they stay until a back lands there.
    // 当前不在这些记录上：有跳转压在了它们之上，因此它们保留到返回落到那里为止。
    if (index === -1) return false;
    let count = 0;
    while (index - count >= 0 && !this.entries[index - count]?.open) count += 1;
    if (count === 0) return false;
    this.entries.splice(index - count + 1, count);
    this.ownPops += 1;
    this.port.go(-count);
    return true;
  }

  private onPop(): void {
    if (this.ownPops > 0) {
      this.ownPops -= 1;
      this.flush();
      return;
    }
    // Back (or forward) moved to another entry: every overlay whose entry lies above it was left.
    // 返回（或前进）到了另一条记录：记录位于其上方的所有浮层都已离开。
    const current = this.current() ?? 0;
    const left = this.entries.filter((e) => e.id > current);
    this.entries = this.entries.filter((e) => e.id <= current);
    for (const entry of left.reverse()) {
      if (!entry.open) continue;
      entry.open = false;
      entry.close();
    }
    this.flush();
  }
}

let shared: OverlayHistory | null = null;

function browserHistory(): OverlayHistory {
  shared ??= new OverlayHistory({
    readState: () => window.history.state,
    pushState: (state) => window.history.pushState(state, ''),
    go: (delta) => window.history.go(delta),
    onPop: (listener) => window.addEventListener('popstate', listener),
    later: (task) => {
      setTimeout(task, 0);
    },
  });
  return shared;
}

/**
 * While `active`, the system back gesture or button calls onClose instead of leaving the page. Closing the
 * overlay any other way removes the history entry again.
 * `active` 为 true 期间，系统返回手势或返回键调用 onClose，而不是离开页面。以其他方式关闭浮层时，会再次移除这条历史记录。
 */
export function useBackToClose(onClose: () => void, active = true): void {
  const closeRef = useRef(onClose);
  useLayoutEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    if (!active || typeof window === 'undefined') return;
    return browserHistory().open(() => closeRef.current());
  }, [active]);
}
