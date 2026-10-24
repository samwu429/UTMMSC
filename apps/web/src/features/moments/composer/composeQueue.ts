import type { MomentMediaInput } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { tr } from '../../../shared/i18n/locale';
import { newMomentClientId, type LocalMedia, type UploadBatch, type UploadItem, type UploadStatus } from '../model';
import { prepareMomentMedia, type MediaKind, type PickedMedia, type PreparedMedia } from './mediaPrep';
import { moveItem } from './reorder';

/**
 * The uploads of one composer session, started the moment files are picked: each file is prepared one at a
 * time (prepareImage and the preview, or the video's metadata and frame), then uploaded with its preview,
 * three items at a time with a progress figure per tile. A failed upload is tried twice more with backoff;
 * while the device is offline nothing starts, uploads in flight go back to the queue without spending a try,
 * and everything resumes on online. Implements the UploadBatch the feed store waits on after 发表.
 * Everything that touches the browser comes in through ComposeQueueEnv, so the queue is tested in Node.
 * 一次编辑的全部上传，从选中文件的那一刻开始：每个文件依次处理（prepareImage 和预览图，或视频的元数据和画面），然后连同预览图一起上传，
 * 同时最多三个，每个图块都有进度。上传失败会退避后再试两次；设备离线期间不开始新的上传，正在进行的上传退回队列且不计入重试次数，
 * 联网后全部继续。实现「发表」后动态 store 所等待的 UploadBatch。所有涉及浏览器的部分都经由 ComposeQueueEnv 传入，因此可以在 Node 中测试。
 */

/** Items uploading at once. */
/** 同时上传的项目数。 */
export const UPLOAD_CONCURRENCY = 3;
/** Tries after the first failure of an item. */
/** 项目第一次失败后的重试次数。 */
export const UPLOAD_RETRIES = 2;
/** Wait before each retry. */
/** 每次重试之前的等待时间。 */
export const RETRY_DELAYS_MS: readonly number[] = [1500, 4000];
/**
 * How long a stored object is trusted for a post. The server deletes uploads that no post uses after 24 hours, so
 * an object stored longer ago than this is sent again before the batch resolves (a kept batch or a local post
 * published or retried the next day).
 * 已保存的对象可用于发表的时长。服务器会在 24 小时后删除没有被任何动态使用的上传，因此保存时间超过这个时长的对象会在批次完成之前重新上传
 * （例如保留下来的批次，或第二天才发表或重试的本地动态）。
 */
export const UPLOAD_REUSE_MS = 20 * 60 * 60 * 1000;
/** Progress changes smaller than this do not re-render the tiles. */
/** 小于这个幅度的进度变化不会触发图块重新渲染。 */
const PROGRESS_STEP = 0.01;

/** What POST /members/me/media answers, as far as the queue needs it. */
/** POST /members/me/media 的返回值中队列需要的部分。 */
export interface StoredObject {
  key: string;
  contentType: string;
}

/**
 * Uploads one blob under its own content type, reporting progress from 0 to 1. Rejects with a TypeError on a
 * network failure, an error carrying the HTTP status otherwise, and an AbortError when the signal fires.
 * 以 blob 自身的内容类型上传，并报告 0 到 1 的进度。网络失败时以 TypeError 拒绝，其他失败时以带 HTTP 状态码的错误拒绝，
 * signal 触发时以 AbortError 拒绝。
 */
export type UploadTransport = (file: Blob, options: { signal: AbortSignal; onProgress: (fraction: number) => void }) => Promise<StoredObject>;

export interface ComposeQueueEnv {
  upload: UploadTransport;
  /** Rejects when the file cannot be used; the tile is then dropped and onProblem listeners hear why. */
  /** 文件无法使用时拒绝；图块随即被移除，onProblem 的监听者会收到原因。 */
  prepare(picked: PickedMedia, url: string): Promise<PreparedMedia>;
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
  isOnline(): boolean;
  /** Calls back on every online or offline event. Returns the unsubscribe function. */
  /** 每次 online 或 offline 事件时回调。返回取消订阅的函数。 */
  watchOnline(listener: (online: boolean) => void): () => void;
  /** Runs `task` after `ms`. Returns the function that cancels it. */
  /** 在 `ms` 之后运行 `task`。返回取消它的函数。 */
  schedule(task: () => void, ms: number): () => void;
  /** The localized line a failed tile carries. */
  /** 失败图块附带的已翻译文字。 */
  failureText(error: unknown): string;
  newId(): string;
  /** The current time in ms, for the age of stored objects. */
  /** 当前时间（毫秒），用于计算已保存对象的存放时长。 */
  now(): number;
}

/** The composer's side of the batch: picking, removing and ordering tiles while it is open. */
/** 编辑器使用的批次接口：打开期间添加、移除图块并调整顺序。 */
export interface ComposeBatch extends UploadBatch {
  /** Adds the accepted part of a pick (see planPick) after the current tiles and starts preparing it. */
  /** 把一次选择中被接受的部分（见 planPick）加在现有图块之后，并开始处理。 */
  add(picked: readonly PickedMedia[]): void;
  /** Drops a tile: its upload is aborted and its object URLs are revoked. */
  /** 移除一个图块：中止其上传并释放其对象地址。 */
  remove(id: string): void;
  move(from: number, to: number): void;
  /** Tapping a failed tile. */
  /** 轻触失败的图块。 */
  retryItem(id: string): void;
  /** The kind of the tiles, or null when there are none. */
  /** 图块的类型；没有图块时为 null。 */
  kind(): MediaKind | null;
  /** False while the device says it is offline. */
  /** 设备报告离线期间为 false。 */
  online(): boolean;
  /** Hears each file that could not be prepared. Returns the unsubscribe function. */
  /** 接收每个无法处理的文件。返回取消订阅的函数。 */
  onProblem(listener: (error: unknown, picked: PickedMedia) => void): () => void;
}

/** The error a waiting whenUploaded() and a cancelled tile get; the same shape fetch and XHR use. */
/** 等待中的 whenUploaded() 和被取消的图块收到的错误；与 fetch 和 XHR 使用的形式相同。 */
export function uploadAbortError(): Error {
  if (typeof DOMException === 'function') return new DOMException('Upload aborted', 'AbortError');
  const error = new Error('Upload aborted');
  error.name = 'AbortError';
  return error;
}

export function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError';
}

/** Network failures, timeouts, rate limits and server errors are tried again; refusals such as a bad type are not. */
/** 网络失败、超时、频率限制和服务器错误会重试；类型不对之类的拒绝不会。 */
export function isRetryableUploadError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  const status = typeof error === 'object' && error !== null ? (error as { status?: unknown }).status : undefined;
  if (typeof status !== 'number') return false;
  return status === 0 || status === 408 || status === 429 || status >= 500;
}

type Phase = UploadStatus;

interface Part {
  blob: Blob;
  key: string | null;
  /** Bytes sent in the current attempt. */
  /** 本次尝试已发送的字节数。 */
  loaded: number;
  /** env.now() when the server answered with the key; null while there is no key. */
  /** 服务器返回 key 时的 env.now()；没有 key 时为 null。 */
  storedAt: number | null;
}

interface Entry {
  id: string;
  picked: PickedMedia;
  /** Every object URL this entry made; all are revoked when it goes. */
  /** 这个项目创建的全部对象地址；项目移除时全部释放。 */
  urls: string[];
  local: LocalMedia;
  phase: Phase;
  file: Part | null;
  preview: Part | null;
  /** Failed attempts of the current run. */
  /** 本轮已失败的尝试次数。 */
  failures: number;
  error: unknown;
  failure: string | null;
  controller: AbortController | null;
  /** Cancels the pending retry; set while the entry waits out its backoff. */
  /** 取消待执行的重试；项目在退避等待期间设置。 */
  cancelRetry: (() => void) | null;
  /** cancel() came while the file was still being prepared. */
  /** 文件仍在处理时调用了 cancel()。 */
  cancelAfterPrep: boolean;
  item: UploadItem;
}

function progressOf(entry: Entry): number {
  if (entry.phase === 'done') return 1;
  const parts = [entry.file, entry.preview].filter((part): part is Part => part !== null);
  const total = parts.reduce((sum, part) => sum + part.blob.size, 0);
  if (!(total > 0)) return 0;
  const sent = parts.reduce((sum, part) => sum + (part.key ? part.blob.size : Math.min(part.loaded, part.blob.size)), 0);
  return Math.min(1, Math.max(0, sent / total));
}

function uploadedOf(entry: Entry): MomentMediaInput | null {
  if (entry.phase !== 'done' || !entry.file?.key) return null;
  const media: MomentMediaInput = { key: entry.file.key, contentType: entry.local.contentType };
  if (entry.local.width !== null && entry.local.height !== null) {
    media.width = entry.local.width;
    media.height = entry.local.height;
  }
  if (entry.preview?.key) media.previewKey = entry.preview.key;
  if (entry.local.kind === 'video' && entry.local.durationMs !== null) media.durationMs = entry.local.durationMs;
  return media;
}

function snapshot(entry: Entry): UploadItem {
  return { id: entry.id, local: entry.local, status: entry.phase, progress: progressOf(entry), uploaded: uploadedOf(entry), failure: entry.failure };
}

interface Waiter {
  resolve: (media: MomentMediaInput[]) => void;
  reject: (error: unknown) => void;
}

export function createComposeBatch(env: ComposeQueueEnv): ComposeBatch {
  const id = env.newId();
  let seq = 0;
  let entries: Entry[] = [];
  let cachedItems: readonly UploadItem[] | null = null;
  const listeners = new Set<() => void>();
  const problemListeners = new Set<(error: unknown, picked: PickedMedia) => void>();
  let waiters: Waiter[] = [];
  const prepQueue: Entry[] = [];
  let preparing = false;
  let released = false;
  let stopWatching: (() => void) | null = null;

  const isOnline = () => env.isOnline();
  const alive = (entry: Entry) => !released && entries.includes(entry);

  function touch(entry: Entry) {
    entry.item = snapshot(entry);
  }

  function changed() {
    cachedItems = null;
    for (const listener of [...listeners]) listener();
    settle();
  }

  function settle() {
    if (!waiters.length) return;
    const failed = entries.find((entry) => entry.phase === 'failed');
    if (failed) {
      const pending = waiters;
      waiters = [];
      for (const waiter of pending) waiter.reject(failed.error ?? new Error(failed.failure ?? 'Upload failed'));
      return;
    }
    if (!entries.every((entry) => entry.phase === 'done')) return;
    // Objects the server may already have cleaned up are sent again first; the waiters resolve once they are stored.
    // 服务器可能已经清理掉的对象先重新上传；保存完成后等待者才会得到结果。
    if (renewExpired()) {
      changed();
      pump();
      return;
    }
    const media = entries.map((entry) => uploadedOf(entry)).filter((item): item is MomentMediaInput => item !== null);
    const pending = waiters;
    waiters = [];
    for (const waiter of pending) waiter.resolve(media);
  }

  /**
   * Puts every finished entry holding an object stored UPLOAD_REUSE_MS ago or longer back in the queue, with that
   * object's key cleared so only it is uploaded again. True when any was.
   * 把持有已保存 UPLOAD_REUSE_MS 或更久的对象的已完成项目放回队列，并清除该对象的 key，只重新上传这一个对象。有任何项目被放回时为 true。
   */
  function renewExpired(): boolean {
    const now = env.now();
    let renewed = false;
    for (const entry of entries) {
      if (entry.phase !== 'done') continue;
      let expired = false;
      for (const part of [entry.file, entry.preview]) {
        if (!part?.key || part.storedAt === null || now - part.storedAt < UPLOAD_REUSE_MS) continue;
        part.key = null;
        part.storedAt = null;
        part.loaded = 0;
        expired = true;
      }
      if (!expired) continue;
      entry.phase = 'queued';
      entry.failures = 0;
      touch(entry);
      renewed = true;
    }
    return renewed;
  }

  function stopEntry(entry: Entry) {
    entry.controller?.abort();
    entry.controller = null;
    entry.cancelRetry?.();
    entry.cancelRetry = null;
  }

  function revokeEntry(entry: Entry) {
    for (const url of entry.urls) env.revokeObjectURL(url);
    entry.urls = [];
  }

  function watch() {
    if (stopWatching || released) return;
    stopWatching = env.watchOnline((online) => {
      if (released) return;
      if (!online) {
        // An XHR on a dropped network can hang for minutes, so uploads in flight go back to the queue at once.
        // 网络断开时 XHR 可能挂起好几分钟，因此正在进行的上传立即退回队列。
        for (const entry of entries) {
          if (entry.phase !== 'uploading') continue;
          entry.controller?.abort();
          entry.controller = null;
          entry.phase = 'queued';
          touch(entry);
        }
      }
      changed();
      pump();
    });
  }

  function pump() {
    if (released || !isOnline()) return;
    let active = entries.filter((entry) => entry.phase === 'uploading').length;
    for (const entry of entries) {
      if (active >= UPLOAD_CONCURRENCY) break;
      if (entry.phase !== 'queued' || entry.cancelRetry) continue;
      active += 1;
      void run(entry);
    }
  }

  async function run(entry: Entry) {
    const controller = new AbortController();
    entry.controller = controller;
    entry.phase = 'uploading';
    touch(entry);
    changed();
    const current = () => alive(entry) && entry.controller === controller;
    try {
      for (const part of [entry.file, entry.preview]) {
        if (!part || part.key) continue;
        part.loaded = 0;
        const stored = await env.upload(part.blob, {
          signal: controller.signal,
          onProgress: (fraction) => {
            if (!current()) return;
            part.loaded = Math.max(0, Math.min(1, fraction)) * part.blob.size;
            const progress = progressOf(entry);
            if (Math.abs(progress - entry.item.progress) < PROGRESS_STEP) return;
            touch(entry);
            changed();
          },
        });
        if (!current()) return;
        part.key = stored.key;
        part.storedAt = env.now();
        part.loaded = part.blob.size;
        touch(entry);
        changed();
      }
      entry.controller = null;
      entry.phase = 'done';
      entry.failures = 0;
      entry.error = null;
      entry.failure = null;
      touch(entry);
      changed();
    } catch (error) {
      if (!current()) return;
      entry.controller = null;
      if (isAbortError(error)) return;
      if (!isOnline()) {
        // Offline: wait for online without spending a try.
        // 离线：等待联网，不计入重试次数。
        entry.phase = 'queued';
      } else if (isRetryableUploadError(error) && entry.failures < UPLOAD_RETRIES) {
        const delay = RETRY_DELAYS_MS[entry.failures] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1] ?? 0;
        entry.failures += 1;
        entry.phase = 'queued';
        entry.cancelRetry = env.schedule(() => {
          entry.cancelRetry = null;
          pump();
        }, delay);
      } else {
        entry.phase = 'failed';
        entry.error = error;
        entry.failure = env.failureText(error);
      }
      touch(entry);
      changed();
    } finally {
      pump();
    }
  }

  function applyPrepared(entry: Entry, prepared: PreparedMedia) {
    let fileUrl = entry.local.fileUrl;
    if (prepared.file !== entry.picked.file) {
      // The prepared photo replaces the original, whose URL only served while the tile was preparing.
      // 处理后的照片取代原图；原图的地址只在图块处理期间使用。
      const next = env.createObjectURL(prepared.file);
      env.revokeObjectURL(fileUrl);
      entry.urls = entry.urls.filter((url) => url !== fileUrl).concat(next);
      fileUrl = next;
    }
    let previewUrl: string | null = null;
    if (prepared.preview) {
      previewUrl = env.createObjectURL(prepared.preview);
      entry.urls.push(previewUrl);
    }
    entry.local = {
      kind: prepared.kind,
      contentType: prepared.contentType,
      fileUrl,
      previewUrl,
      width: prepared.width,
      height: prepared.height,
      durationMs: prepared.durationMs,
    };
    entry.file = { blob: prepared.file, key: null, loaded: 0, storedAt: null };
    entry.preview = prepared.preview ? { blob: prepared.preview, key: null, loaded: 0, storedAt: null } : null;
    if (entry.cancelAfterPrep) {
      entry.cancelAfterPrep = false;
      entry.phase = 'failed';
      entry.error = uploadAbortError();
      entry.failure = env.failureText(entry.error);
    } else {
      entry.phase = 'queued';
    }
    touch(entry);
  }

  async function runPrep() {
    if (preparing || released) return;
    const entry = prepQueue.shift();
    if (!entry) return;
    if (!alive(entry)) {
      void runPrep();
      return;
    }
    preparing = true;
    try {
      const prepared = await env.prepare(entry.picked, entry.local.fileUrl);
      if (!alive(entry)) return;
      applyPrepared(entry, prepared);
      changed();
      pump();
    } catch (error) {
      if (!alive(entry)) return;
      revokeEntry(entry);
      entries = entries.filter((other) => other !== entry);
      changed();
      for (const listener of [...problemListeners]) listener(error, entry.picked);
    } finally {
      preparing = false;
      void runPrep();
    }
  }

  function requeue(entry: Entry): boolean {
    if (entry.phase === 'preparing' && entry.cancelAfterPrep) {
      entry.cancelAfterPrep = false;
      return true;
    }
    if (entry.phase === 'queued' && entry.cancelRetry) {
      // 重试 should not sit out the rest of a backoff.
      // 「重试」不必等完剩下的退避时间。
      entry.cancelRetry();
      entry.cancelRetry = null;
      return true;
    }
    if (entry.phase !== 'failed') return false;
    entry.phase = 'queued';
    entry.failures = 0;
    entry.error = null;
    entry.failure = null;
    touch(entry);
    return true;
  }

  return {
    id,
    items() {
      cachedItems ??= entries.map((entry) => entry.item);
      return cachedItems;
    },
    subscribe(listener) {
      if (released) return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    whenUploaded() {
      return new Promise<MomentMediaInput[]>((resolve, reject) => {
        if (released) {
          reject(uploadAbortError());
          return;
        }
        waiters.push({ resolve, reject });
        settle();
      });
    },
    retry() {
      if (released) return;
      let any = false;
      for (const entry of entries) any = requeue(entry) || any;
      if (!any) return;
      changed();
      pump();
    },
    cancel() {
      if (released) return;
      for (const entry of entries) {
        if (entry.phase === 'done' || entry.phase === 'failed') continue;
        if (entry.phase === 'preparing') {
          entry.cancelAfterPrep = true;
          continue;
        }
        stopEntry(entry);
        entry.phase = 'failed';
        entry.error = uploadAbortError();
        entry.failure = env.failureText(entry.error);
        touch(entry);
      }
      changed();
    },
    release() {
      if (released) return;
      released = true;
      for (const entry of entries) {
        stopEntry(entry);
        revokeEntry(entry);
      }
      entries = [];
      prepQueue.length = 0;
      stopWatching?.();
      stopWatching = null;
      const pending = waiters;
      waiters = [];
      for (const waiter of pending) waiter.reject(uploadAbortError());
      cachedItems = null;
      for (const listener of [...listeners]) listener();
      listeners.clear();
      problemListeners.clear();
    },
    add(picked) {
      if (released || !picked.length) return;
      watch();
      for (const media of picked) {
        const url = env.createObjectURL(media.file);
        seq += 1;
        const entry: Entry = {
          id: `${id}-${seq}`,
          picked: media,
          urls: [url],
          local: { kind: media.kind, contentType: media.contentType, fileUrl: url, previewUrl: null, width: null, height: null, durationMs: null },
          phase: 'preparing',
          file: null,
          preview: null,
          failures: 0,
          error: null,
          failure: null,
          controller: null,
          cancelRetry: null,
          cancelAfterPrep: false,
          item: undefined as unknown as UploadItem,
        };
        touch(entry);
        entries.push(entry);
        prepQueue.push(entry);
      }
      changed();
      void runPrep();
    },
    remove(itemId) {
      const entry = entries.find((other) => other.id === itemId);
      if (!entry || released) return;
      stopEntry(entry);
      revokeEntry(entry);
      entries = entries.filter((other) => other !== entry);
      changed();
      pump();
    },
    move(from, to) {
      if (released) return;
      const next = moveItem(entries, from, to);
      if (next.every((entry, index) => entry === entries[index])) return;
      entries = next;
      changed();
    },
    retryItem(itemId) {
      const entry = entries.find((other) => other.id === itemId);
      if (!entry || released || !requeue(entry)) return;
      changed();
      pump();
    },
    kind() {
      return entries[0]?.picked.kind ?? null;
    },
    online() {
      return isOnline();
    },
    onProblem(listener) {
      if (released) return () => {};
      problemListeners.add(listener);
      return () => {
        problemListeners.delete(listener);
      };
    },
  };
}

/**
 * The browser side of the queue, given the upload transport: the media prep, object URLs, the online
 * events, timers and the failure text through errorMessage.
 * 队列在浏览器中的实现，由调用方提供上传方式：媒体处理、对象地址、online 事件、计时器，以及经 errorMessage 得到的失败文字。
 */
export function browserComposeEnv(upload: UploadTransport): ComposeQueueEnv {
  return {
    upload,
    prepare: prepareMomentMedia,
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
    isOnline: () => typeof navigator === 'undefined' || navigator.onLine !== false,
    watchOnline(listener) {
      const onOnline = () => listener(true);
      const onOffline = () => listener(false);
      window.addEventListener('online', onOnline);
      window.addEventListener('offline', onOffline);
      return () => {
        window.removeEventListener('online', onOnline);
        window.removeEventListener('offline', onOffline);
      };
    },
    schedule(task, ms) {
      const timer = setTimeout(task, ms);
      return () => clearTimeout(timer);
    },
    failureText: (error) => (isAbortError(error) ? tr('发送失败', "Couldn't send") : errorMessage(error)),
    newId: newMomentClientId,
    now: () => Date.now(),
  };
}
