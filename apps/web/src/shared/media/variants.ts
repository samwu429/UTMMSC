import { MediaDecodeError, documentCanvas, renderVariantsWith, type RenderedVariants } from './canvas';
import type { VariantSpec } from './sizing';

/**
 * Resized copies of an image, made in a worker with OffscreenCanvas where the browser has one, so decoding and
 * encoding a 12MP photo never blocks a scroll or a keystroke. Anything the worker cannot do (no OffscreenCanvas, as
 * in Safari before 16.4, a format it cannot decode, a crash or a stall) is done again on the main thread. Rejects
 * with MediaDecodeError when neither can decode the image.
 * 生成图片的缩放副本。浏览器支持 OffscreenCanvas 时在 Worker 中完成，解码和编码一张 1200 万像素的照片时不会卡住滚动或输入。
 * Worker 做不到的情况（没有 OffscreenCanvas，例如 16.4 之前的 Safari；无法解码的格式；崩溃或卡住）改在主线程重新完成。
 * 两者都无法解码时以 MediaDecodeError 拒绝。
 */

/** A worker job taking longer than this is treated as stuck; the worker is replaced and the main thread takes over. */
/** Worker 任务超过这个时间视为卡住；Worker 被替换，改由主线程完成。 */
const WORKER_JOB_MS = 20_000;
/** An idle worker is closed after this long, which frees its memory. */
/** 空闲的 Worker 在这段时间后关闭，释放内存。 */
const WORKER_IDLE_MS = 30_000;

interface WorkerReply {
  id: number;
  ok: boolean;
  unsupported?: boolean;
  width?: number;
  height?: number;
  outputs?: RenderedVariants['outputs'];
}

interface Job {
  resolve: (result: RenderedVariants) => void;
  reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

let worker: Worker | null = null;
/** Set once the worker proved it cannot help on this device; every later job goes to the main thread. */
/** 一旦 Worker 证明在这台设备上无能为力就设置；之后的任务都交给主线程。 */
let workerUnavailable = false;
let nextId = 1;
const jobs = new Map<number, Job>();
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function workerUsable(): boolean {
  return !workerUnavailable && typeof Worker === 'function' && typeof OffscreenCanvas === 'function' && typeof createImageBitmap === 'function';
}

function closeWorker(): void {
  worker?.terminate();
  worker = null;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
}

function failAll(error: unknown): void {
  for (const job of jobs.values()) {
    clearTimeout(job.timer);
    job.reject(error);
  }
  jobs.clear();
}

function scheduleIdleClose(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = jobs.size === 0 ? setTimeout(closeWorker, WORKER_IDLE_MS) : null;
}

function ensureWorker(): Worker {
  if (worker) return worker;
  const created = new Worker(new URL('./variants.worker.ts', import.meta.url), { type: 'module' });
  created.onmessage = (event: MessageEvent<WorkerReply>) => {
    const reply = event.data;
    const job = jobs.get(reply.id);
    if (!job) return;
    jobs.delete(reply.id);
    clearTimeout(job.timer);
    if (reply.ok && reply.outputs && typeof reply.width === 'number' && typeof reply.height === 'number') {
      job.resolve({ width: reply.width, height: reply.height, outputs: reply.outputs });
    } else {
      if (reply.unsupported) workerUnavailable = true;
      job.reject(new Error('worker'));
    }
    scheduleIdleClose();
  };
  created.onerror = () => {
    // A worker that fails to load or crashes is not tried again on this page.
    // 加载失败或崩溃的 Worker 在本页面上不再使用。
    workerUnavailable = true;
    closeWorker();
    failAll(new Error('worker'));
  };
  worker = created;
  return created;
}

function renderInWorker(blob: Blob, specs: readonly VariantSpec[]): Promise<RenderedVariants> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      if (!jobs.delete(id)) return;
      // A stuck worker is replaced, since a later job would only queue behind it.
      // 卡住的 Worker 会被替换，因为之后的任务只会排在它后面。
      closeWorker();
      failAll(new Error('worker'));
      reject(new Error('worker'));
    }, WORKER_JOB_MS);
    jobs.set(id, { resolve, reject, timer });
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    try {
      ensureWorker().postMessage({ id, blob, specs });
    } catch (error) {
      jobs.delete(id);
      clearTimeout(timer);
      workerUnavailable = true;
      reject(error);
    }
  });
}

export async function renderVariants(blob: Blob, specs: readonly VariantSpec[]): Promise<RenderedVariants> {
  if (workerUsable()) {
    try {
      return await renderInWorker(blob, specs);
    } catch {
      // The main thread tries again; it can also decode with an img element, which a worker cannot.
      // 主线程重试一次；它还能用 img 元素解码，而 Worker 不能。
    }
  }
  try {
    return await renderVariantsWith(blob, specs, documentCanvas);
  } catch (error) {
    throw error instanceof MediaDecodeError ? error : new MediaDecodeError();
  }
}
