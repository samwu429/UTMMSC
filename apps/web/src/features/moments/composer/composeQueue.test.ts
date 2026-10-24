import { describe, expect, it } from 'vitest';
import type { MediaKind, PickedMedia, PreparedMedia } from './mediaPrep';
import {
  RETRY_DELAYS_MS,
  UPLOAD_CONCURRENCY,
  UPLOAD_REUSE_MS,
  createComposeBatch,
  isAbortError,
  isRetryableUploadError,
  uploadAbortError,
  type ComposeQueueEnv,
  type StoredObject,
} from './composeQueue';

interface FakeUpload {
  blob: Blob;
  aborted: boolean;
  progress(fraction: number): void;
  succeed(key?: string): void;
  fail(error: unknown): void;
}

interface FakePrep {
  picked: PickedMedia;
  url: string;
  succeed(prepared?: Partial<PreparedMedia>): void;
  fail(error: unknown): void;
}

interface FakeTimer {
  ms: number;
  task: () => void;
  cancelled: boolean;
  ran: boolean;
}

/** Lets pending promise callbacks run. */
/** 让待处理的 promise 回调执行。 */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function fakeEnv({ autoPrepare = true }: { autoPrepare?: boolean } = {}) {
  let online = true;
  let clock = 0;
  let urlSeq = 0;
  let keySeq = 0;
  const live = new Set<string>();
  const uploads: FakeUpload[] = [];
  const preps: FakePrep[] = [];
  const timers: FakeTimer[] = [];
  const onlineListeners = new Set<(online: boolean) => void>();

  function defaultPrepared(picked: PickedMedia): PreparedMedia {
    return {
      kind: picked.kind,
      contentType: picked.contentType,
      file: picked.file,
      width: 400,
      height: 300,
      durationMs: picked.kind === 'video' ? 15_000 : null,
      preview: new Blob(['p'.repeat(10)], { type: 'image/jpeg' }),
    };
  }

  const env: ComposeQueueEnv = {
    upload: (blob, { signal, onProgress }) =>
      new Promise<StoredObject>((resolve, reject) => {
        const upload: FakeUpload = {
          blob,
          aborted: false,
          progress: (fraction) => onProgress(fraction),
          succeed: (key) => {
            keySeq += 1;
            resolve({ key: key ?? `moments/me/k${keySeq}.${blob.type === 'image/jpeg' ? 'jpg' : 'bin'}`, contentType: blob.type });
          },
          fail: (error) => reject(error),
        };
        signal.addEventListener('abort', () => {
          upload.aborted = true;
          reject(uploadAbortError());
        });
        uploads.push(upload);
      }),
    prepare: (picked, url) =>
      new Promise<PreparedMedia>((resolve, reject) => {
        const prep: FakePrep = { picked, url, succeed: (prepared) => resolve({ ...defaultPrepared(picked), ...prepared }), fail: reject };
        preps.push(prep);
        if (autoPrepare) prep.succeed();
      }),
    createObjectURL: () => {
      urlSeq += 1;
      const url = `blob:${urlSeq}`;
      live.add(url);
      return url;
    },
    revokeObjectURL: (url) => {
      live.delete(url);
    },
    isOnline: () => online,
    watchOnline: (listener) => {
      onlineListeners.add(listener);
      return () => {
        onlineListeners.delete(listener);
      };
    },
    schedule: (task, ms) => {
      const timer: FakeTimer = { ms, task, cancelled: false, ran: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    failureText: (error) => (isAbortError(error) ? 'cancelled' : `failed ${(error as { status?: number }).status ?? 'network'}`),
    newId: () => 'batch',
    now: () => clock,
  };

  return {
    env,
    live,
    uploads,
    preps,
    timers,
    listenerCount: () => onlineListeners.size,
    inFlight: () => uploads.filter((upload) => !upload.aborted && !settled.has(upload)),
    advance(ms: number) {
      clock += ms;
    },
    setOnline(value: boolean) {
      online = value;
      for (const listener of [...onlineListeners]) listener(value);
    },
    runTimers() {
      for (const timer of timers) {
        if (timer.cancelled || timer.ran) continue;
        timer.ran = true;
        timer.task();
      }
    },
  };
}

/** Uploads that answered, so inFlight() leaves them out. */
/** 已经有结果的上传，inFlight() 不再计入。 */
const settled = new WeakSet<FakeUpload>();

function finish(upload: FakeUpload | undefined, key?: string) {
  if (!upload) throw new Error('no upload');
  settled.add(upload);
  upload.succeed(key);
}

function reject(upload: FakeUpload | undefined, error: unknown) {
  if (!upload) throw new Error('no upload');
  settled.add(upload);
  upload.fail(error);
}

function picked(name: string, kind: MediaKind = 'image', bytes = 90): PickedMedia {
  const contentType = kind === 'video' ? 'video/mp4' : 'image/png';
  return { file: new File(['x'.repeat(bytes)], name, { type: contentType }), kind, contentType };
}

function statuses(batch: { items(): readonly { status: string }[] }): string[] {
  return batch.items().map((item) => item.status);
}

describe('compose queue', () => {
  it('prepares each file, then uploads three items at a time', async () => {
    const fake = fakeEnv();
    const batch = createComposeBatch(fake.env);
    batch.add(['a', 'b', 'c', 'd', 'e'].map((name) => picked(name)));
    expect(statuses(batch)).toEqual(['preparing', 'preparing', 'preparing', 'preparing', 'preparing']);
    await flush();
    expect(fake.inFlight()).toHaveLength(UPLOAD_CONCURRENCY);
    expect(statuses(batch)).toEqual(['uploading', 'uploading', 'uploading', 'queued', 'queued']);

    // The first item's file is stored, so its preview goes next in the same slot.
    // 第一项的文件已保存，同一位置接着上传它的预览图。
    finish(fake.uploads[0]);
    await flush();
    expect(fake.inFlight()).toHaveLength(UPLOAD_CONCURRENCY);
    expect(fake.uploads[3]?.blob.type).toBe('image/jpeg');
    finish(fake.uploads[3]);
    await flush();
    expect(statuses(batch)).toEqual(['done', 'uploading', 'uploading', 'uploading', 'queued']);
    expect(fake.inFlight()).toHaveLength(UPLOAD_CONCURRENCY);
  });

  it('reports progress across the file and its preview', async () => {
    const fake = fakeEnv();
    const batch = createComposeBatch(fake.env);
    batch.add([picked('a', 'image', 90)]);
    await flush();
    fake.uploads[0]?.progress(0.5);
    expect(batch.items()[0]?.progress).toBeCloseTo(0.45);
    finish(fake.uploads[0]);
    await flush();
    expect(batch.items()[0]?.progress).toBeCloseTo(0.9);
    fake.uploads[1]?.progress(0.5);
    expect(batch.items()[0]?.progress).toBeCloseTo(0.95);
    finish(fake.uploads[1]);
    await flush();
    expect(batch.items()[0]).toMatchObject({ status: 'done', progress: 1 });
  });

  it('keeps the items array until something changes', async () => {
    const fake = fakeEnv();
    const batch = createComposeBatch(fake.env);
    let calls = 0;
    batch.subscribe(() => {
      calls += 1;
    });
    batch.add([picked('a')]);
    const first = batch.items();
    expect(batch.items()).toBe(first);
    await flush();
    expect(batch.items()).not.toBe(first);
    expect(calls).toBeGreaterThan(0);
    // A change smaller than a percent is not worth a render.
    // 小于百分之一的变化不值得重新渲染。
    const before = batch.items();
    fake.uploads[0]?.progress(0.001);
    expect(batch.items()).toBe(before);
  });

  it('resolves with the media in post order, sizes and previews included', async () => {
    const fake = fakeEnv();
    const batch = createComposeBatch(fake.env);
    batch.add([picked('a'), picked('b')]);
    await flush();
    const waiting = batch.whenUploaded();
    let resolved = false;
    void waiting.then(() => {
      resolved = true;
    });
    finish(fake.uploads[0], 'moments/me/a.png');
    finish(fake.uploads[1], 'moments/me/b.png');
    await flush();
    expect(resolved).toBe(false);
    finish(fake.uploads[2], 'moments/me/a-p.jpg');
    finish(fake.uploads[3], 'moments/me/b-p.jpg');
    await flush();
    batch.move(1, 0);
    expect(await batch.whenUploaded()).toEqual([
      { key: 'moments/me/b.png', contentType: 'image/png', width: 400, height: 300, previewKey: 'moments/me/b-p.jpg' },
      { key: 'moments/me/a.png', contentType: 'image/png', width: 400, height: 300, previewKey: 'moments/me/a-p.jpg' },
    ]);
    expect(await waiting).toHaveLength(2);
  });

  it('sends a video length, and leaves out sizes and previews it does not have', async () => {
    const fake = fakeEnv({ autoPrepare: false });
    const batch = createComposeBatch(fake.env);
    batch.add([picked('clip', 'video')]);
    await flush();
    fake.preps[0]?.succeed({ width: null, height: null, preview: null, durationMs: 15_000 });
    await flush();
    expect(fake.uploads).toHaveLength(1);
    finish(fake.uploads[0], 'moments/me/v.mp4');
    expect(await batch.whenUploaded()).toEqual([{ key: 'moments/me/v.mp4', contentType: 'video/mp4', durationMs: 15_000 }]);
  });

  it('resolves at once with nothing to upload', async () => {
    const batch = createComposeBatch(fakeEnv().env);
    expect(await batch.whenUploaded()).toEqual([]);
  });

  it('tries twice more with backoff, then fails the tile and rejects', async () => {
    const fake = fakeEnv();
    const batch = createComposeBatch(fake.env);
    batch.add([picked('a')]);
    await flush();
    const waiting = batch.whenUploaded();
    const outcome = waiting.then(
      () => 'resolved',
      (error: unknown) => error,
    );

    reject(fake.uploads[0], { status: 503 });
    await flush();
    expect(statuses(batch)).toEqual(['queued']);
    expect(fake.timers.map((timer) => timer.ms)).toEqual([RETRY_DELAYS_MS[0]]);
    expect(fake.inFlight()).toHaveLength(0);
    fake.runTimers();
    await flush();
    expect(fake.uploads).toHaveLength(2);

    reject(fake.uploads[1], new TypeError('Network request failed'));
    await flush();
    expect(fake.timers.map((timer) => timer.ms)).toEqual([RETRY_DELAYS_MS[0], RETRY_DELAYS_MS[1]]);
    fake.runTimers();
    await flush();

    reject(fake.uploads[2], { status: 502 });
    await flush();
    expect(batch.items()[0]).toMatchObject({ status: 'failed', failure: 'failed 502' });
    expect(fake.uploads).toHaveLength(3);
    expect(await outcome).toEqual({ status: 502 });
    // A new promise for a batch with a failed tile rejects at once.
    // 批次中有失败图块时，新的 promise 立即拒绝。
    await expect(batch.whenUploaded()).rejects.toEqual({ status: 502 });
  });

  it('fails a refusal at once without retrying', async () => {
    const fake = fakeEnv();
    const batch = createComposeBatch(fake.env);
    batch.add([picked('a')]);
    await flush();
    reject(fake.uploads[0], { status: 400 });
    await flush();
    expect(batch.items()[0]).toMatchObject({ status: 'failed', failure: 'failed 400' });
    expect(fake.timers).toHaveLength(0);
  });

  it('retries failed tiles and keeps the parts already stored', async () => {
    const fake = fakeEnv();
    const batch = createComposeBatch(fake.env);
    batch.add([picked('a'), picked('b')]);
    await flush();
    finish(fake.uploads[0], 'moments/me/a.png');
    finish(fake.uploads[1], 'moments/me/b.png');
    await flush();
    // a's file is stored; its preview is refused, then b's preview is stored.
    // a 的文件已保存，其预览图被拒绝；随后 b 的预览图保存成功。
    reject(fake.uploads[2], { status: 400 });
    finish(fake.uploads[3], 'moments/me/b-p.jpg');
    await flush();
    expect(statuses(batch)).toEqual(['failed', 'done']);
    const sent = fake.uploads.length;

    batch.retry();
    await flush();
    expect(statuses(batch)).toEqual(['uploading', 'done']);
    expect(fake.uploads).toHaveLength(sent + 1);
    expect(fake.uploads[sent]?.blob.type).toBe('image/jpeg');
    finish(fake.uploads[sent], 'moments/me/a-p.jpg');
    const media = await batch.whenUploaded();
    expect(media.map((item) => [item.key, item.previewKey])).toEqual([
      ['moments/me/a.png', 'moments/me/a-p.jpg'],
      ['moments/me/b.png', 'moments/me/b-p.jpg'],
    ]);
  });

  it('retries one tapped tile, and skips the rest of a backoff', async () => {
    const fake = fakeEnv();
    const batch = createComposeBatch(fake.env);
    batch.add([picked('a')]);
    await flush();
    reject(fake.uploads[0], { status: 500 });
    await flush();
    expect(statuses(batch)).toEqual(['queued']);
    const id = batch.items()[0]?.id ?? '';
    batch.retryItem(id);
    await flush();
    expect(fake.timers[0]?.cancelled).toBe(true);
    expect(statuses(batch)).toEqual(['uploading']);
    expect(fake.uploads).toHaveLength(2);
  });

  it('pauses while offline and resumes on online', async () => {
    const fake = fakeEnv();
    fake.setOnline(false);
    const batch = createComposeBatch(fake.env);
    batch.add([picked('a'), picked('b')]);
    await flush();
    expect(batch.online()).toBe(false);
    expect(statuses(batch)).toEqual(['queued', 'queued']);
    expect(fake.uploads).toHaveLength(0);

    fake.setOnline(true);
    await flush();
    expect(statuses(batch)).toEqual(['uploading', 'uploading']);
  });

  it('puts uploads in flight back in the queue when the device goes offline, without spending a try', async () => {
    const fake = fakeEnv();
    const batch = createComposeBatch(fake.env);
    batch.add([picked('a')]);
    await flush();
    fake.uploads[0]?.progress(0.5);
    fake.setOnline(false);
    await flush();
    expect(fake.uploads[0]?.aborted).toBe(true);
    expect(statuses(batch)).toEqual(['queued']);

    // A network failure seen while offline does not count either.
    // 离线时遇到的网络失败同样不计入。
    fake.setOnline(true);
    await flush();
    fake.env.isOnline = () => false;
    reject(fake.uploads[1], new TypeError('Network request failed'));
    await flush();
    expect(statuses(batch)).toEqual(['queued']);
    expect(fake.timers).toHaveLength(0);
    fake.env.isOnline = () => true;
    fake.setOnline(true);
    await flush();
    expect(statuses(batch)).toEqual(['uploading']);
    for (const failure of [1, 2]) {
      reject(fake.uploads[fake.uploads.length - 1], { status: 503 });
      await flush();
      expect(fake.timers).toHaveLength(failure);
      fake.runTimers();
      await flush();
    }
    expect(statuses(batch)).toEqual(['uploading']);
  });

  it('drops a removed tile, aborts its upload and frees its slot', async () => {
    const fake = fakeEnv();
    const batch = createComposeBatch(fake.env);
    batch.add(['a', 'b', 'c', 'd'].map((name) => picked(name)));
    await flush();
    const [first] = batch.items();
    const urls = [first?.local.fileUrl, first?.local.previewUrl];
    batch.remove(first?.id ?? '');
    await flush();
    expect(fake.uploads[0]?.aborted).toBe(true);
    expect(statuses(batch)).toEqual(['uploading', 'uploading', 'uploading']);
    for (const url of urls) expect(fake.live.has(url ?? '')).toBe(false);
  });

  it('drops a file that cannot be prepared and says why', async () => {
    const fake = fakeEnv({ autoPrepare: false });
    const batch = createComposeBatch(fake.env);
    const problems: string[] = [];
    batch.onProblem((error, media) => problems.push(`${media.file.name}:${String(error)}`));
    batch.add([picked('bad'), picked('good')]);
    await flush();
    // Files are prepared one at a time.
    // 文件逐个处理。
    expect(fake.preps).toHaveLength(1);
    fake.preps[0]?.fail('invalid');
    await flush();
    expect(problems).toEqual(['bad:invalid']);
    expect(batch.items().map((item) => item.status)).toEqual(['preparing']);
    expect(fake.live.has(fake.preps[0]?.url ?? '')).toBe(false);
    expect(fake.preps).toHaveLength(2);
    fake.preps[1]?.succeed();
    await flush();
    expect(statuses(batch)).toEqual(['uploading']);
  });

  it('shows the prepared photo and its preview, and revokes the original', async () => {
    const fake = fakeEnv({ autoPrepare: false });
    const batch = createComposeBatch(fake.env);
    batch.add([picked('big')]);
    const original = batch.items()[0]?.local.fileUrl ?? '';
    expect(fake.live.has(original)).toBe(true);
    await flush();
    fake.preps[0]?.succeed({ file: new Blob(['smaller'], { type: 'image/jpeg' }), contentType: 'image/jpeg' });
    await flush();
    const local = batch.items()[0]?.local;
    expect(fake.live.has(original)).toBe(false);
    expect(local?.fileUrl).not.toBe(original);
    expect(fake.live.has(local?.fileUrl ?? '')).toBe(true);
    expect(fake.live.has(local?.previewUrl ?? '')).toBe(true);
    expect(local).toMatchObject({ contentType: 'image/jpeg', width: 400, height: 300 });
  });

  it('cancels unfinished uploads, keeps the blobs, and can start again', async () => {
    const fake = fakeEnv({ autoPrepare: false });
    const batch = createComposeBatch(fake.env);
    batch.add([picked('a'), picked('b')]);
    await flush();
    fake.preps[0]?.succeed();
    await flush();
    const waiting = batch.whenUploaded();
    batch.cancel();
    await expect(waiting).rejects.toSatisfy(isAbortError);
    expect(fake.uploads[0]?.aborted).toBe(true);
    expect(statuses(batch)).toEqual(['failed', 'preparing']);
    expect(batch.items()[0]?.failure).toBe('cancelled');
    // The item still preparing fails once it is ready, without uploading.
    // 仍在处理的项目处理完后直接失败，不会上传。
    fake.preps[1]?.succeed();
    await flush();
    expect(statuses(batch)).toEqual(['failed', 'failed']);
    expect(fake.uploads).toHaveLength(1);
    for (const item of batch.items()) expect(fake.live.has(item.local.fileUrl)).toBe(true);

    batch.retry();
    await flush();
    expect(statuses(batch)).toEqual(['uploading', 'uploading']);
  });

  it('releases every blob, aborts everything and stops listening', async () => {
    const fake = fakeEnv();
    const batch = createComposeBatch(fake.env);
    batch.add([picked('a'), picked('b')]);
    await flush();
    expect(fake.live.size).toBe(4);
    expect(fake.listenerCount()).toBe(1);
    const waiting = batch.whenUploaded();
    let heard = 0;
    batch.subscribe(() => {
      heard += 1;
    });
    batch.release();
    await expect(waiting).rejects.toSatisfy(isAbortError);
    await expect(batch.whenUploaded()).rejects.toSatisfy(isAbortError);
    expect(fake.live.size).toBe(0);
    expect(fake.uploads.every((upload) => upload.aborted)).toBe(true);
    expect(fake.listenerCount()).toBe(0);
    expect(batch.items()).toEqual([]);
    expect(heard).toBe(1);
    // Nothing comes back to life afterwards.
    // 之后不会再恢复任何操作。
    batch.add([picked('c')]);
    batch.retry();
    fake.setOnline(true);
    await flush();
    expect(batch.items()).toEqual([]);
    expect(fake.live.size).toBe(0);
  });

  it('drops a file whose preparation ends after release', async () => {
    const fake = fakeEnv({ autoPrepare: false });
    const batch = createComposeBatch(fake.env);
    batch.add([picked('a')]);
    await flush();
    batch.release();
    fake.preps[0]?.succeed();
    await flush();
    expect(fake.live.size).toBe(0);
    expect(fake.uploads).toHaveLength(0);
  });

  it('uploads again what was stored longer ago than the server keeps unused uploads, only once someone waits', async () => {
    const fake = fakeEnv();
    const batch = createComposeBatch(fake.env);
    batch.add([picked('a')]);
    await flush();
    finish(fake.uploads[0], 'moments/me/a.png');
    await flush();
    finish(fake.uploads[1], 'moments/me/a-p.jpg');
    await flush();
    expect(statuses(batch)).toEqual(['done']);

    // Still within the window: the stored keys are used as they are.
    // 仍在期限内：直接使用已保存的 key。
    fake.advance(UPLOAD_REUSE_MS - 1);
    expect((await batch.whenUploaded()).map((item) => [item.key, item.previewKey])).toEqual([['moments/me/a.png', 'moments/me/a-p.jpg']]);

    // Past it, nothing happens while nobody waits; a publish then sends both objects again before it resolves.
    // 超过期限后，没有人等待时什么也不做；发表时会先重新上传两个对象，然后才得到结果。
    fake.advance(1);
    await flush();
    expect(fake.uploads).toHaveLength(2);
    let resolved = false;
    const waiting = batch.whenUploaded().then((media) => {
      resolved = true;
      return media;
    });
    await flush();
    expect(resolved).toBe(false);
    expect(statuses(batch)).toEqual(['uploading']);
    expect(fake.uploads).toHaveLength(3);
    expect(batch.items()[0]?.progress).toBe(0);
    finish(fake.uploads[2], 'moments/me/a2.png');
    await flush();
    expect(resolved).toBe(false);
    finish(fake.uploads[3], 'moments/me/a2-p.jpg');
    expect((await waiting).map((item) => [item.key, item.previewKey])).toEqual([['moments/me/a2.png', 'moments/me/a2-p.jpg']]);
  });

  it('sends again only the part stored too long ago, keeping a fresh one', async () => {
    const fake = fakeEnv();
    const batch = createComposeBatch(fake.env);
    batch.add([picked('a')]);
    await flush();
    finish(fake.uploads[0], 'moments/me/a.png');
    await flush();
    reject(fake.uploads[1], { status: 400 });
    await flush();
    expect(statuses(batch)).toEqual(['failed']);

    // A day later the failed preview is retried; the file stored back then has to go again too.
    // 一天之后重试失败的预览图；当时保存的文件也必须重新上传。
    fake.advance(UPLOAD_REUSE_MS + 60_000);
    batch.retry();
    await flush();
    expect(fake.uploads).toHaveLength(3);
    expect(fake.uploads[2]?.blob.type).toBe('image/jpeg');
    const waiting = batch.whenUploaded();
    finish(fake.uploads[2], 'moments/me/a-p.jpg');
    await flush();
    expect(fake.uploads).toHaveLength(4);
    expect(fake.uploads[3]?.blob.type).toBe('image/png');
    finish(fake.uploads[3], 'moments/me/a2.png');
    expect(await waiting).toEqual([{ key: 'moments/me/a2.png', contentType: 'image/png', width: 400, height: 300, previewKey: 'moments/me/a-p.jpg' }]);
  });

  it('reports the kind of its tiles', async () => {
    const batch = createComposeBatch(fakeEnv().env);
    expect(batch.kind()).toBeNull();
    batch.add([picked('clip', 'video')]);
    expect(batch.kind()).toBe('video');
  });
});

describe('upload errors', () => {
  it('retries network failures, timeouts, rate limits and server errors only', () => {
    expect(isRetryableUploadError(new TypeError('Network request failed'))).toBe(true);
    for (const status of [0, 408, 429, 500, 503]) expect(isRetryableUploadError({ status })).toBe(true);
    for (const status of [400, 401, 403, 413, 415]) expect(isRetryableUploadError({ status })).toBe(false);
    expect(isRetryableUploadError(new Error('boom'))).toBe(false);
    expect(isRetryableUploadError(null)).toBe(false);
  });

  it('recognizes aborts', () => {
    expect(isAbortError(uploadAbortError())).toBe(true);
    expect(isAbortError(new Error('x'))).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
  });
});
