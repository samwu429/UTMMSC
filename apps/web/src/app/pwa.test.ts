import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  UPDATE_CHECK_TIMEOUT_MS,
  UPDATE_HANDOVER_DELAY_MS,
  UPDATE_HOLD_MAX_MS,
  UPDATE_LAUNCH_APPLY_MS,
  UPDATE_RECHECK_MS,
  UPDATE_RELOAD_FLAG,
  appUpdateHolds,
  consumeUpdateReload,
  createAppUpdater,
  createUpdateHolds,
  holdAppUpdate,
  markUpdateReload,
  withTimeout,
  type ContainerLike,
  type FlagStorage,
  type RegistrationLike,
} from './pwa';

class MemoryStorage implements FlagStorage {
  readonly items = new Map<string, string>();
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
}

class FakeWorker {
  readonly messages: unknown[] = [];
  private readonly listeners: Array<() => void> = [];
  constructor(public state: string = 'installing') {}
  postMessage(message: unknown) {
    this.messages.push(message);
  }
  addEventListener(_type: 'statechange', listener: () => void) {
    this.listeners.push(listener);
  }
  become(state: string) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}

class FakeRegistration implements RegistrationLike {
  installing: FakeWorker | null = null;
  waiting: FakeWorker | null = null;
  updates = 0;
  answer: () => Promise<unknown> = () => Promise.resolve();
  private readonly found: Array<() => void> = [];
  update() {
    this.updates += 1;
    return this.answer();
  }
  addEventListener(_type: 'updatefound', listener: () => void) {
    this.found.push(listener);
  }
  /** The browser found a new build and starts installing it. */
  startInstall(worker: FakeWorker) {
    this.installing = worker;
    for (const listener of this.found) listener();
  }
  /** The install finished; the worker now waits. */
  finishInstall(worker: FakeWorker) {
    this.installing = null;
    this.waiting = worker;
    worker.become('installed');
  }
}

class FakeContainer implements ContainerLike {
  readonly registration = new FakeRegistration();
  readonly registered: Array<{ url: string; options: RegistrationOptions }> = [];
  failRegister = false;
  private readonly changes: Array<() => void> = [];
  constructor(public controller: unknown) {}
  async register(url: string, options: RegistrationOptions) {
    this.registered.push({ url, options });
    if (this.failRegister) throw new Error('blocked');
    return this.registration;
  }
  addEventListener(_type: 'controllerchange', listener: () => void) {
    this.changes.push(listener);
  }
  takeOver() {
    this.controller = { next: true };
    for (const listener of this.changes) listener();
  }
}

class FakeDocument {
  private readonly listeners: Array<() => void> = [];
  constructor(public visibilityState: DocumentVisibilityState = 'visible') {}
  addEventListener(_type: 'visibilitychange', listener: () => void) {
    this.listeners.push(listener);
  }
  show(state: DocumentVisibilityState) {
    this.visibilityState = state;
    for (const listener of this.listeners) listener();
  }
}

function setup({ controller = {}, visibility = 'visible' }: { controller?: unknown; visibility?: DocumentVisibilityState } = {}) {
  const container = new FakeContainer(controller);
  const doc = new FakeDocument(visibility);
  const storage = new MemoryStorage();
  const reload = vi.fn();
  const holds = createUpdateHolds();
  let now = 1_000_000;
  const updater = createAppUpdater({
    container,
    document: doc,
    storage,
    reload,
    now: () => now,
    scriptUrl: '/UTMMSC/sw.js',
    scope: '/UTMMSC/',
    holds,
  });
  return {
    container,
    registration: container.registration,
    doc,
    storage,
    reload,
    holds,
    updater,
    advance(ms: number) {
      now += ms;
    },
    /** The app goes to the background and stays there long enough for a handover. */
    /** 应用转到后台，并停留到足以接管的时间。 */
    goAway() {
      doc.show('hidden');
      vi.advanceTimersByTime(UPDATE_HANDOVER_DELAY_MS);
    },
  };
}

const SKIP = { type: 'SKIP_WAITING' };

describe('createAppUpdater', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('registers the worker without the HTTP cache and checks once', async () => {
    const { container, registration, updater } = setup();
    await updater.start();
    expect(container.registered).toEqual([{ url: '/UTMMSC/sw.js', options: { scope: '/UTMMSC/', updateViaCache: 'none' } }]);
    expect(registration.updates).toBe(1);
  });

  it('never rejects when the worker cannot be registered, and then checks nothing', async () => {
    const { container, registration, updater } = setup();
    container.failRegister = true;
    await expect(updater.start()).resolves.toBeUndefined();
    await updater.check();
    expect(registration.updates).toBe(0);
  });

  it('gives up on a stalled check after the timeout instead of waiting for the network', async () => {
    const { registration, updater } = setup();
    registration.answer = () => new Promise(() => undefined);
    let started = false;
    void updater.start().then(() => {
      started = true;
    });
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_TIMEOUT_MS - 1);
    expect(started).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(started).toBe(true);
  });

  it('treats a failed check like no update', async () => {
    const { registration, updater, reload } = setup();
    registration.answer = () => Promise.reject(new Error('offline'));
    await expect(updater.start()).resolves.toBeUndefined();
    expect(reload).not.toHaveBeenCalled();
  });

  it('shares one check between callers', async () => {
    const { registration, updater } = setup();
    let finish: () => void = () => undefined;
    registration.answer = () => new Promise<void>((resolve) => (finish = resolve));
    const first = updater.start();
    await vi.advanceTimersByTimeAsync(0);
    const second = updater.check();
    expect(registration.updates).toBe(1);
    finish();
    await Promise.all([first, second]);
    registration.answer = () => Promise.resolve();
    await updater.check();
    expect(registration.updates).toBe(2);
  });

  it('lets a new build wait while the app is in use and hands over after a minute in the background', async () => {
    const { registration, doc, updater, reload } = setup();
    await updater.start();
    const next = new FakeWorker();
    registration.startInstall(next);
    registration.finishInstall(next);
    expect(next.messages).toEqual([]);
    doc.show('hidden');
    expect(next.messages).toEqual([]);
    vi.advanceTimersByTime(UPDATE_HANDOVER_DELAY_MS - 1);
    expect(next.messages).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(next.messages).toEqual([SKIP]);
    expect(reload).not.toHaveBeenCalled();
  });

  it('keeps the page when the app comes back within the minute, and counts the minute again on the next hide', async () => {
    const { registration, doc, updater } = setup();
    await updater.start();
    const next = new FakeWorker();
    registration.startInstall(next);
    registration.finishInstall(next);
    // A trip to the mail app for a code, or to the file chooser.
    // 去邮箱取验证码，或者打开文件选择器。
    doc.show('hidden');
    vi.advanceTimersByTime(UPDATE_HANDOVER_DELAY_MS - 1);
    doc.show('visible');
    vi.advanceTimersByTime(UPDATE_HANDOVER_DELAY_MS);
    expect(next.messages).toEqual([]);
    doc.show('hidden');
    vi.advanceTimersByTime(UPDATE_HANDOVER_DELAY_MS / 2);
    // A repeated hidden event does not restart the clock.
    // 重复的 hidden 事件不会重新计时。
    doc.show('hidden');
    vi.advanceTimersByTime(UPDATE_HANDOVER_DELAY_MS / 2 - 1);
    expect(next.messages).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(next.messages).toEqual([SKIP]);
  });

  it('hands over at once when the install finishes after the app has been in the background a while', async () => {
    const { registration, updater, goAway } = setup();
    await updater.start();
    const next = new FakeWorker();
    registration.startInstall(next);
    goAway();
    registration.finishInstall(next);
    expect(next.messages).toEqual([SKIP]);
  });

  it('hands over at the end of the minute when the install finishes early in it', async () => {
    const { registration, doc, updater } = setup();
    await updater.start();
    const next = new FakeWorker();
    registration.startInstall(next);
    doc.show('hidden');
    vi.advanceTimersByTime(1000);
    registration.finishInstall(next);
    expect(next.messages).toEqual([]);
    vi.advanceTimersByTime(UPDATE_HANDOVER_DELAY_MS - 1000);
    expect(next.messages).toEqual([SKIP]);
  });

  it('watches a build the browser was already installing before the page registered', async () => {
    const { registration, updater, goAway } = setup();
    const early = new FakeWorker();
    registration.installing = early;
    await updater.start();
    goAway();
    registration.waiting = early;
    registration.installing = null;
    early.become('installed');
    expect(early.messages).toEqual([SKIP]);
  });

  it('applies a build that was already waiting at launch at once, reloading under the film, flagged so it is skipped', async () => {
    const { container, registration, storage, updater, reload } = setup();
    const waiting = new FakeWorker('installed');
    registration.waiting = waiting;
    await updater.start();
    expect(waiting.messages).toEqual([SKIP]);
    container.takeOver();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(storage.getItem(UPDATE_RELOAD_FLAG)).toBe('1');
  });

  it('waits for the background when the takeover asked at launch comes too late', async () => {
    const { container, registration, updater, reload, advance, goAway } = setup();
    registration.waiting = new FakeWorker('installed');
    await updater.start();
    advance(UPDATE_LAUNCH_APPLY_MS + 1);
    container.takeOver();
    expect(reload).not.toHaveBeenCalled();
    goAway();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('leaves a build waiting at launch for the background while a hold is taken', async () => {
    const { registration, holds, updater, goAway } = setup();
    const waiting = new FakeWorker('installed');
    registration.waiting = waiting;
    const release = holds.take();
    await updater.start();
    expect(waiting.messages).toEqual([]);
    release();
    expect(waiting.messages).toEqual([]);
    goAway();
    expect(waiting.messages).toEqual([SKIP]);
  });

  it('reloads after a takeover only once the app has been out of sight a while, flagged so the film is skipped', async () => {
    const { container, doc, storage, updater, reload } = setup();
    await updater.start();
    container.takeOver();
    expect(reload).not.toHaveBeenCalled();
    doc.show('hidden');
    expect(reload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(UPDATE_HANDOVER_DELAY_MS);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(storage.getItem(UPDATE_RELOAD_FLAG)).toBe('1');
    doc.show('visible');
    doc.show('hidden');
    vi.advanceTimersByTime(UPDATE_HANDOVER_DELAY_MS);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads at once when the takeover happens after the app has been in the background a while', async () => {
    const { container, updater, reload, goAway } = setup();
    await updater.start();
    goAway();
    container.takeOver();
    container.takeOver();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('keeps a due handover back while a hold is taken and hands over when the last one is released', async () => {
    const { registration, holds, updater, goAway } = setup();
    await updater.start();
    const next = new FakeWorker();
    registration.startInstall(next);
    registration.finishInstall(next);
    const sending = holds.take();
    const uploading = holds.take();
    goAway();
    expect(next.messages).toEqual([]);
    sending();
    sending();
    expect(next.messages).toEqual([]);
    uploading();
    expect(next.messages).toEqual([SKIP]);
  });

  it('never reloads on a takeover while a hold is taken, and reloads once it is released out of sight', async () => {
    const { container, doc, holds, updater, reload, goAway } = setup();
    await updater.start();
    const release = holds.take();
    goAway();
    // Another tab handed over to the new build while this one was sending.
    // 这个标签页正在发送时，另一个标签页把控制权交给了新版本。
    container.takeOver();
    expect(reload).not.toHaveBeenCalled();
    doc.show('visible');
    release();
    expect(reload).not.toHaveBeenCalled();
    goAway();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('stops honouring a hold that is never released once it reaches its cap', async () => {
    const { registration, holds, updater, goAway } = setup();
    await updater.start();
    const next = new FakeWorker();
    registration.startInstall(next);
    registration.finishInstall(next);
    holds.take();
    goAway();
    vi.advanceTimersByTime(UPDATE_HOLD_MAX_MS - UPDATE_HANDOVER_DELAY_MS - 1);
    expect(next.messages).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(next.messages).toEqual([SKIP]);
  });

  it('never hands over or reloads on a first visit, which has no worker to replace', async () => {
    const { container, registration, updater, reload, goAway } = setup({ controller: null });
    const leftover = new FakeWorker('installed');
    registration.waiting = leftover;
    await updater.start();
    expect(leftover.messages).toEqual([]);
    const first = new FakeWorker();
    registration.startInstall(first);
    registration.finishInstall(first);
    goAway();
    container.takeOver();
    expect(first.messages).toEqual([]);
    expect(reload).not.toHaveBeenCalled();
  });

  it('checks again on return to the foreground, at most every half hour', async () => {
    const { registration, doc, updater, advance } = setup();
    await updater.start();
    expect(registration.updates).toBe(1);
    doc.show('hidden');
    advance(UPDATE_RECHECK_MS - 1);
    doc.show('visible');
    await vi.advanceTimersByTimeAsync(0);
    expect(registration.updates).toBe(1);
    doc.show('hidden');
    advance(1);
    doc.show('visible');
    await vi.advanceTimersByTimeAsync(0);
    expect(registration.updates).toBe(2);
  });

  it('hands over a build found by a background check that ends while the app is away', async () => {
    const { registration, updater, goAway } = setup();
    await updater.start();
    goAway();
    let finish: () => void = () => undefined;
    registration.answer = () => new Promise<void>((resolve) => (finish = resolve));
    const check = updater.check();
    const next = new FakeWorker('installed');
    registration.waiting = next;
    finish();
    await check;
    expect(next.messages).toEqual([SKIP]);
  });
});

describe('update holds', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('counts holds, releases each only once, and tells listeners when the last one goes', () => {
    const holds = createUpdateHolds();
    const free = vi.fn();
    const unsubscribe = holds.onFree(free);
    expect(holds.held).toBe(false);
    const first = holds.take();
    const second = holds.take();
    expect(holds.held).toBe(true);
    first();
    first();
    expect(holds.held).toBe(true);
    expect(free).not.toHaveBeenCalled();
    second();
    expect(holds.held).toBe(false);
    expect(free).toHaveBeenCalledTimes(1);
    unsubscribe();
    holds.take()();
    expect(free).toHaveBeenCalledTimes(1);
  });

  it('lets a hold go by itself at the cap, after which its late release changes nothing', () => {
    const holds = createUpdateHolds();
    const free = vi.fn();
    holds.onFree(free);
    const forgotten = holds.take();
    vi.advanceTimersByTime(UPDATE_HOLD_MAX_MS - 1);
    expect(holds.held).toBe(true);
    vi.advanceTimersByTime(1);
    expect(holds.held).toBe(false);
    expect(free).toHaveBeenCalledTimes(1);
    const other = holds.take();
    forgotten();
    expect(holds.held).toBe(true);
    other();
    expect(free).toHaveBeenCalledTimes(2);
  });

  it('are what holdAppUpdate takes for the page', () => {
    expect(appUpdateHolds.held).toBe(false);
    const release = holdAppUpdate();
    expect(appUpdateHolds.held).toBe(true);
    release();
    expect(appUpdateHolds.held).toBe(false);
  });
});

describe('withTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('passes the value through when it arrives in time', async () => {
    await expect(withTimeout(Promise.resolve(7), 100)).resolves.toBe(7);
  });

  it('resolves undefined after the time is up', async () => {
    const result = withTimeout(new Promise(() => undefined), 100);
    await vi.advanceTimersByTimeAsync(100);
    await expect(result).resolves.toBeUndefined();
  });

  it('passes a failure through', async () => {
    await expect(withTimeout(Promise.reject(new Error('nope')), 100)).rejects.toThrow('nope');
  });
});

describe('the update reload flag', () => {
  it('is read once', () => {
    const storage = new MemoryStorage();
    expect(consumeUpdateReload(storage)).toBe(false);
    markUpdateReload(storage);
    expect(consumeUpdateReload(storage)).toBe(true);
    expect(consumeUpdateReload(storage)).toBe(false);
  });

  it('is shared with old builds, which set the same key', () => {
    const storage = new MemoryStorage();
    storage.setItem('utmmsc.sw-reloaded', '1');
    expect(consumeUpdateReload(storage)).toBe(true);
  });

  it('is simply absent without storage, or when storage throws', () => {
    expect(consumeUpdateReload(null)).toBe(false);
    expect(() => markUpdateReload(null)).not.toThrow();
    const broken: FlagStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => undefined,
    };
    expect(() => markUpdateReload(broken)).not.toThrow();
    expect(consumeUpdateReload(broken)).toBe(false);
  });
});
