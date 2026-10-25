import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RenderedVariants } from './canvas';
import type { VariantSpec } from './sizing';

vi.mock('./canvas', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./canvas')>();
  return { ...actual, renderVariantsWith: vi.fn() };
});

const SPECS: VariantSpec[] = [{ longEdge: 360, type: 'image/jpeg', quality: 0.75 }];
const PHOTO = new Blob([new Uint8Array(4)], { type: 'image/jpeg' });
const FROM_WORKER: RenderedVariants = { width: 4032, height: 3024, outputs: [{ blob: new Blob(['w']), width: 360, height: 270 }] };
const FROM_PAGE: RenderedVariants = { width: 4032, height: 3024, outputs: [{ blob: new Blob(['p']), width: 360, height: 270 }] };

/** A worker stand-in: tests read what was posted and answer through onmessage. */
/** Worker 替身：测试读取发出的消息，并通过 onmessage 答复。 */
class FakeWorker {
  static made: FakeWorker[] = [];
  posted: { id: number; blob: Blob; specs: VariantSpec[] }[] = [];
  terminated = false;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(
    public readonly url: URL,
    public readonly options: unknown,
  ) {
    FakeWorker.made.push(this);
  }
  postMessage(message: { id: number; blob: Blob; specs: VariantSpec[] }) {
    this.posted.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  reply(data: Record<string, unknown>) {
    this.onmessage?.({ data });
  }
}

async function load() {
  vi.resetModules();
  const canvas = await import('./canvas');
  const variants = await import('./variants');
  const page = vi.mocked(canvas.renderVariantsWith);
  page.mockReset();
  page.mockResolvedValue(FROM_PAGE);
  return { renderVariants: variants.renderVariants, page, MediaDecodeError: canvas.MediaDecodeError };
}

function withWorkerGlobals() {
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('OffscreenCanvas', class {});
  vi.stubGlobal('createImageBitmap', vi.fn());
}

/** Lets the promise chain inside renderVariants reach the worker. */
/** 让 renderVariants 内部的 Promise 链走到 Worker。 */
async function settle() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

beforeEach(() => {
  FakeWorker.made = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('renderVariants', () => {
  it('uses the main thread where there is no worker', async () => {
    const { renderVariants, page } = await load();
    await expect(renderVariants(PHOTO, SPECS)).resolves.toBe(FROM_PAGE);
    expect(page).toHaveBeenCalledTimes(1);
    expect(page.mock.calls[0]?.[0]).toBe(PHOTO);
  });

  it('does the work in a module worker when OffscreenCanvas exists', async () => {
    withWorkerGlobals();
    const { renderVariants, page } = await load();
    const job = renderVariants(PHOTO, SPECS);
    await settle();
    const worker = FakeWorker.made[0];
    expect(worker?.options).toEqual({ type: 'module' });
    expect(worker?.url.pathname.endsWith('/variants.worker.ts')).toBe(true);
    expect(worker?.posted[0]).toEqual({ id: 1, blob: PHOTO, specs: SPECS });
    worker?.reply({ id: 1, ok: true, ...FROM_WORKER });
    await expect(job).resolves.toEqual(FROM_WORKER);
    expect(page).not.toHaveBeenCalled();
  });

  it('falls back to the main thread for good once the worker cannot draw', async () => {
    withWorkerGlobals();
    const { renderVariants, page } = await load();
    const first = renderVariants(PHOTO, SPECS);
    await settle();
    FakeWorker.made[0]?.reply({ id: 1, ok: false, unsupported: true });
    await expect(first).resolves.toBe(FROM_PAGE);
    await expect(renderVariants(PHOTO, SPECS)).resolves.toBe(FROM_PAGE);
    expect(FakeWorker.made[0]?.posted).toHaveLength(1);
    expect(page).toHaveBeenCalledTimes(2);
  });

  it('retries one failed job on the main thread but keeps the worker for the next', async () => {
    withWorkerGlobals();
    const { renderVariants, page } = await load();
    const first = renderVariants(PHOTO, SPECS);
    await settle();
    FakeWorker.made[0]?.reply({ id: 1, ok: false });
    await expect(first).resolves.toBe(FROM_PAGE);
    const second = renderVariants(PHOTO, SPECS);
    await settle();
    expect(FakeWorker.made[0]?.posted).toHaveLength(2);
    FakeWorker.made[0]?.reply({ id: 2, ok: true, ...FROM_WORKER });
    await expect(second).resolves.toEqual(FROM_WORKER);
    expect(page).toHaveBeenCalledTimes(1);
  });

  it('gives up on a worker that crashes', async () => {
    withWorkerGlobals();
    const { renderVariants, page } = await load();
    const first = renderVariants(PHOTO, SPECS);
    await settle();
    FakeWorker.made[0]?.onerror?.();
    await expect(first).resolves.toBe(FROM_PAGE);
    expect(FakeWorker.made[0]?.terminated).toBe(true);
    await renderVariants(PHOTO, SPECS);
    expect(FakeWorker.made).toHaveLength(1);
    expect(page).toHaveBeenCalledTimes(2);
  });

  it('replaces a stuck worker after 20s and closes an idle one after 30s', async () => {
    vi.useFakeTimers();
    withWorkerGlobals();
    const { renderVariants, page } = await load();
    const stuck = renderVariants(PHOTO, SPECS);
    await settle();
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(stuck).resolves.toBe(FROM_PAGE);
    expect(FakeWorker.made[0]?.terminated).toBe(true);
    expect(page).toHaveBeenCalledTimes(1);

    const next = renderVariants(PHOTO, SPECS);
    await settle();
    const fresh = FakeWorker.made[1];
    expect(fresh?.posted).toHaveLength(1);
    fresh?.reply({ id: fresh.posted[0]?.id ?? 0, ok: true, ...FROM_WORKER });
    await expect(next).resolves.toEqual(FROM_WORKER);
    expect(fresh?.terminated).toBe(false);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fresh?.terminated).toBe(true);
  });

  it('rejects with MediaDecodeError when the main thread cannot decode either', async () => {
    const { renderVariants, page, MediaDecodeError } = await load();
    page.mockRejectedValue(new Error('canvas'));
    await expect(renderVariants(PHOTO, SPECS)).rejects.toBeInstanceOf(MediaDecodeError);
  });
});
