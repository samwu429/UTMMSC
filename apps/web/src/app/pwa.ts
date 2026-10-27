/**
 * Service worker updates that never hold up a launch or change the app under someone's hands.
 * - The worker is registered and checked for updates in the background; the check gives up after 3 s.
 * - A build that is already waiting at launch takes over at once, and the page reloads under the opening film,
 *   before anyone uses it.
 * - A new build that installs while the app is in use waits. It takes over only after the app has been in the
 *   background for a minute, and never while work that lives only in memory (a chat message or a moment on its way)
 *   is unfinished; the page then reloads out of sight, without the opening film.
 * - A first visit does not wait for the precache: the app runs from the network until the next launch.
 * Service Worker 更新从不拖慢启动，也不会在有人使用时替换应用。
 * - 在后台注册 Service Worker 并检查更新；检查 3 秒后放弃。
 * - 启动时已经在等待的新版本立即接管，页面在开屏影片下面重新加载，那时还没有人在使用。
 * - 应用使用期间安装好的新版本会等待。只有应用转到后台满一分钟后才接管，而且只保存在内存中的工作（正在发送的聊天消息或动态）
 *   没有完成时从不接管；页面随后在看不见的时候重新加载，不再播放开屏影片。
 * - 第一次访问不等待预缓存：应用直接从网络运行，直到下次启动。
 */

/** Set right before a reload caused by an update, so the reloaded page skips the opening film. */
/** 因更新而重新加载之前设置，重新加载后的页面据此跳过开屏影片。 */
export const UPDATE_RELOAD_FLAG = 'utmmsc.sw-reloaded';
export const UPDATE_CHECK_TIMEOUT_MS = 3000;
/** An app left open in the background is checked again when it returns, at most this often. */
/** 一直留在后台的应用回到前台时会再检查一次，但不会比这更频繁。 */
export const UPDATE_RECHECK_MS = 30 * 60 * 1000;
/**
 * How long the app stays in the background before a waiting build takes over. A quick trip to the mail app for a
 * code, or to a file chooser, comes back to the same page.
 * 应用在后台停留多久之后，等待中的新版本才接管。去邮箱取验证码、打开文件选择器这类短暂的离开，回来时还是原来的页面。
 */
export const UPDATE_HANDOVER_DELAY_MS = 60 * 1000;
/** A build told to take over at launch that does so later than this waits for the background, as the app may be in use by then. */
/** 启动时被通知接管的新版本如果晚于这个时间才接管，就改为等应用转到后台，因为那时应用可能已经在使用中。 */
export const UPDATE_LAUNCH_APPLY_MS = 3000;
/** The longest one hold keeps an update back, so a hold never released by mistake cannot keep the page on an old build for good. */
/** 单个占用最多能把更新推迟多久，这样因疏忽而从未释放的占用也不会让页面永远停在旧版本上。 */
export const UPDATE_HOLD_MAX_MS = 30 * 60 * 1000;

export interface FlagStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function markUpdateReload(storage: FlagStorage | null): void {
  try {
    storage?.setItem(UPDATE_RELOAD_FLAG, '1');
  } catch {
    // Without session storage the reloaded page simply plays the film.
    // 没有会话存储时，重新加载的页面只是照常播放开屏影片。
  }
}

/** True once after a reload caused by an update; the flag is removed as it is read. */
/** 因更新而重新加载后只返回一次 true；读取时即删除该标记。 */
export function consumeUpdateReload(storage: FlagStorage | null): boolean {
  try {
    if (storage?.getItem(UPDATE_RELOAD_FLAG) !== '1') return false;
    storage.removeItem(UPDATE_RELOAD_FLAG);
    return true;
  } catch {
    return false;
  }
}

/** Resolves with the promise, or with undefined after ms; the work itself goes on either way. */
/** 返回原 promise 的结果，或在 ms 毫秒后返回 undefined；无论哪种情况，原来的工作都会继续进行。 */
export function withTimeout<T>(promise: Promise<T>, ms: number, timers: Pick<typeof globalThis, 'setTimeout' | 'clearTimeout'> = globalThis): Promise<T | undefined> {
  return new Promise<T | undefined>((resolve, reject) => {
    const timer = timers.setTimeout(() => resolve(undefined), ms);
    promise.then(
      (value) => {
        timers.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        timers.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Work that lives only in this page's memory, such as a chat message, a moment or a comment on its way, or a form
 * waiting for its email code, holds back the reload into a new build until it is done.
 * 只保存在本页面内存中的工作（例如正在发送的聊天消息、动态或评论，或者正在等待邮箱验证码的表单）完成之前，不会重新加载到新版本。
 */
export interface UpdateHolds {
  /** Takes a hold and returns its release; releasing again does nothing. */
  /** 占用一次并返回释放函数；再次释放不起作用。 */
  take(): () => void;
  /** True while any hold is taken. */
  /** 有任何占用时为 true。 */
  readonly held: boolean;
  /** Runs the listener each time the last hold is released; returns the unsubscribe function. */
  /** 每当最后一个占用被释放时调用监听函数；返回取消订阅的函数。 */
  onFree(listener: () => void): () => void;
}

export function createUpdateHolds(timers: Pick<typeof globalThis, 'setTimeout' | 'clearTimeout'> = globalThis, maxMs = UPDATE_HOLD_MAX_MS): UpdateHolds {
  let count = 0;
  const listeners = new Set<() => void>();
  return {
    take() {
      count += 1;
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        timers.clearTimeout(cap);
        count -= 1;
        if (count === 0) for (const listener of [...listeners]) listener();
      };
      const cap = timers.setTimeout(release, maxMs);
      return release;
    },
    get held() {
      return count > 0;
    },
    onFree(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** The page's own holds, taken by the chat outbox, the sticker store, the moments store and the email code field. */
/** 本页面自己的占用，由聊天发送队列、表情 store、好友动态 store 和邮箱验证码输入框获取。 */
export const appUpdateHolds = createUpdateHolds();

/** Holds back the reload into a new build until the returned function is called. */
/** 在调用返回的函数之前，推迟重新加载到新版本。 */
export function holdAppUpdate(): () => void {
  return appUpdateHolds.take();
}

interface WorkerLike {
  readonly state: string;
  postMessage(message: unknown): void;
  addEventListener(type: 'statechange', listener: () => void): void;
}

export interface RegistrationLike {
  readonly installing: WorkerLike | null;
  readonly waiting: WorkerLike | null;
  update(): Promise<unknown>;
  addEventListener(type: 'updatefound', listener: () => void): void;
}

export interface ContainerLike {
  readonly controller: unknown;
  register(scriptUrl: string, options: RegistrationOptions): Promise<RegistrationLike>;
  addEventListener(type: 'controllerchange', listener: () => void): void;
}

export interface UpdaterDeps {
  container: ContainerLike;
  document: { readonly visibilityState: DocumentVisibilityState; addEventListener(type: 'visibilitychange', listener: () => void): void };
  storage: FlagStorage | null;
  reload: () => void;
  now: () => number;
  scriptUrl: string;
  scope: string;
  timers?: Pick<typeof globalThis, 'setTimeout' | 'clearTimeout'>;
  /** Holds that keep a reload back; the page's own by default. */
  /** 推迟重新加载的占用；默认使用本页面自己的。 */
  holds?: UpdateHolds;
}

export interface AppUpdater {
  /** Registers the worker and runs the first check. Never rejects. */
  /** 注册 Service Worker 并进行第一次检查。不会抛出错误。 */
  start(): Promise<void>;
  /** Looks for a new build now (at most one check at a time). */
  /** 立即查找新版本（同一时间最多一次检查）。 */
  check(): Promise<void>;
}

export function createAppUpdater(deps: UpdaterDeps): AppUpdater {
  // A first visit has no worker to replace; the worker that installs then never takes this page over.
  // 第一次访问时没有要替换的 Service Worker；那时安装的 Service Worker 也不会接管这个页面。
  const updating = !!deps.container.controller;
  const timers = deps.timers ?? globalThis;
  const holds = deps.holds ?? appUpdateHolds;
  let registration: RegistrationLike | null = null;
  let checking: Promise<void> | null = null;
  let lastCheck = Number.NEGATIVE_INFINITY;
  let reloadWhenHidden = false;
  let reloading = false;
  /** Runs out UPDATE_HANDOVER_DELAY_MS after the app went to the background; cleared when it comes back. */
  /** 应用转到后台 UPDATE_HANDOVER_DELAY_MS 之后到期；应用回到前台时清除。 */
  let awayTimer: ReturnType<typeof setTimeout> | null = null;
  /** The app has stayed in the background for UPDATE_HANDOVER_DELAY_MS. */
  /** 应用已经在后台停留了 UPDATE_HANDOVER_DELAY_MS。 */
  let away = false;
  /** Until when a takeover is the one start() asked of a build that was already waiting at launch. */
  /** 在此时间之前发生的接管，是 start() 要求启动时已在等待的新版本做的那一次。 */
  let launchUntil = Number.NEGATIVE_INFINITY;

  const hidden = () => deps.document.visibilityState === 'hidden';

  function reload() {
    if (reloading) return;
    reloading = true;
    markUpdateReload(deps.storage);
    deps.reload();
  }

  /**
   * Runs while the app is out of sight: hand over to a waiting build, or finish a takeover that already happened.
   * Only once the app has been away for a while, and never while a hold is taken.
   * 在应用不可见时运行：把控制权交给正在等待的新版本，或完成已经发生的接管。只在应用离开一段时间之后进行，有占用时从不进行。
   */
  function applyWhileHidden() {
    if (!away || !hidden() || holds.held) return;
    if (reloadWhenHidden) {
      reload();
      return;
    }
    const waiting = registration?.waiting;
    if (waiting && deps.container.controller) waiting.postMessage({ type: 'SKIP_WAITING' });
  }

  function watchWorker(worker: WorkerLike | null) {
    worker?.addEventListener('statechange', () => {
      if (worker.state === 'installed') applyWhileHidden();
    });
  }

  function watchInstall(reg: RegistrationLike) {
    // The browser may already be installing a build it found on this navigation, before the page registered.
    // 浏览器可能在页面注册之前，就已经在安装它在这次导航时发现的新版本。
    watchWorker(reg.installing);
    reg.addEventListener('updatefound', () => watchWorker(reg.installing));
  }

  function check(): Promise<void> {
    const reg = registration;
    if (!reg) return Promise.resolve();
    checking ??= (async () => {
      lastCheck = deps.now();
      try {
        await withTimeout(reg.update(), UPDATE_CHECK_TIMEOUT_MS, deps.timers);
      } catch {
        // Offline or the server is unreachable: try again on a later launch or return to the foreground.
        // 离线或服务器不可达：下次启动或回到前台时再试。
      } finally {
        checking = null;
      }
      applyWhileHidden();
    })();
    return checking;
  }

  deps.container.addEventListener('controllerchange', () => {
    if (!updating) return;
    // The new build took over. Its precache no longer has this page's chunks, so the page reloads. The takeover asked
    // at launch happens under the opening film, so that one reloads at once. Any other reloads out of sight: now if
    // the app has been away a while and nothing holds it, otherwise as soon as both are true. A chunk that fails to
    // load before then reloads the page by itself.
    // 新版本已经接管。它的预缓存里不再有本页面的分块，所以页面要重新加载。启动时要求的那次接管发生在开屏影片下面，立即重新加载。
    // 其他情况都在看不见的时候重新加载：应用已经离开一段时间且没有占用就立即加载，否则等两者都满足时再加载。在那之前如果有分块加载失败，页面会自行重新加载。
    if (!holds.held && (deps.now() <= launchUntil || (away && hidden()))) reload();
    else reloadWhenHidden = true;
  });

  deps.document.addEventListener('visibilitychange', () => {
    if (hidden()) {
      // The clock starts at the first hidden event; a repeated one does not restart it.
      // 从第一次 hidden 事件开始计时；重复的事件不会重新计时。
      awayTimer ??= timers.setTimeout(() => {
        awayTimer = null;
        away = hidden();
        applyWhileHidden();
      }, UPDATE_HANDOVER_DELAY_MS);
      return;
    }
    if (awayTimer !== null) timers.clearTimeout(awayTimer);
    awayTimer = null;
    away = false;
    if (deps.now() - lastCheck >= UPDATE_RECHECK_MS) void check();
  });

  // The last hold released while the app is away lets the update through at once.
  // 应用离开期间最后一个占用被释放时，更新立即进行。
  holds.onFree(applyWhileHidden);

  return {
    async start() {
      try {
        registration = await deps.container.register(deps.scriptUrl, { scope: deps.scope, updateViaCache: 'none' });
      } catch {
        // No worker in development, in some private windows, or on an insecure origin.
        // 开发服务器、部分无痕窗口或不安全的源上没有 Service Worker。
        return;
      }
      // A build found on an earlier visit is already waiting: it takes over now, before the app is in use, and the
      // page reloads into it under the opening film. Most updates land this way; the background handover is the fallback.
      // 上次访问时发现的新版本已经在等待：它现在就接管，那时应用还没有被使用，页面在开屏影片下面重新加载到新版本。
      // 大多数更新都这样完成；转到后台时的接管只是后备。
      const waiting = registration.waiting;
      if (updating && waiting && deps.container.controller && !holds.held) {
        launchUntil = deps.now() + UPDATE_LAUNCH_APPLY_MS;
        waiting.postMessage({ type: 'SKIP_WAITING' });
      }
      watchInstall(registration);
      await check();
    },
    check,
  };
}

/** Session storage of the page, or null where it is blocked. Holds the update flag for the splash and chunk reloads. */
/** 页面的会话存储，被禁用时为 null。存放供开屏和分块重新加载使用的更新标记。 */
export function pageSessionStorage(): FlagStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Starts the updater in the browser. A returning visitor's worker is registered at once (it is already installed,
 * so this costs nothing); a first visit waits for the page to finish loading, so the precache download does not
 * compete with the app's own first requests.
 * 在浏览器中启动更新程序。回访者的 Service Worker 立即注册（它已经安装好，几乎没有开销）；第一次访问则等页面加载完毕再注册，
 * 预缓存的下载就不会和应用自己的首批请求抢带宽。
 */
export function startAppUpdates(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const container = navigator.serviceWorker as unknown as ContainerLike;
  const updater = createAppUpdater({
    container,
    document,
    storage: pageSessionStorage(),
    reload: () => window.location.reload(),
    now: () => Date.now(),
    scriptUrl: `${import.meta.env.BASE_URL}sw.js`,
    scope: import.meta.env.BASE_URL,
  });
  const begin = () => void updater.start();
  if (container.controller || document.readyState === 'complete') begin();
  else window.addEventListener('load', begin, { once: true });
}
