import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatImageUploadResponse } from '@utmmsc/shared';
import { ApiClientError } from '../../../shared/api/errors';
import { useSessionStore } from '../../../shared/session/store';
import type { ChatUpload } from '../composer/imagePrep';
import { combinedProgress, uploadChatImage, uploadWithProgress } from './uploadWithProgress';

const jpeg = (size: number) => new Blob([new Uint8Array(size)], { type: 'image/jpeg' });

interface Call {
  file: Blob;
  signal?: AbortSignal;
  progress?: (fraction: number) => void;
  resolve(res: ChatImageUploadResponse): void;
  reject(error: unknown): void;
}

/** An upload stand-in whose calls the test settles one by one. */
/** 上传替身，由测试逐个完成各次调用。 */
function fakeUpload() {
  const calls: Call[] = [];
  const upload = vi.fn(
    (_roomId: string, file: Blob, options: { signal?: AbortSignal; onProgress?: (fraction: number) => void } = {}) =>
      new Promise<ChatImageUploadResponse>((resolve, reject) => {
        calls.push({ file, signal: options.signal, progress: options.onProgress, resolve, reject });
      }),
  );
  return { upload, calls };
}

async function settle() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

describe('combinedProgress', () => {
  it('weighs each part by its bytes', () => {
    expect(combinedProgress([{ loaded: 240, total: 480 }, { loaded: 0, total: 40 }])).toBeCloseTo(240 / 520);
    expect(combinedProgress([{ loaded: 480, total: 480 }, { loaded: 40, total: 40 }])).toBe(1);
  });

  it('clamps odd numbers and copes with nothing to send', () => {
    expect(combinedProgress([{ loaded: 900, total: 100 }])).toBe(1);
    expect(combinedProgress([{ loaded: -5, total: 100 }])).toBe(0);
    expect(combinedProgress([])).toBe(0);
    expect(combinedProgress([{ loaded: 0, total: 0 }])).toBe(0);
  });
});

describe('uploadChatImage', () => {
  it('uploads the main copy and the thumbnail in parallel and returns both keys and the new size', async () => {
    const picked = jpeg(3_000_000);
    const copies: ChatUpload = { main: jpeg(480), thumb: jpeg(40), width: 2048, height: 1536 };
    const prepare = vi.fn(async () => copies);
    const { upload, calls } = fakeUpload();
    const progress: number[] = [];
    const job = uploadChatImage('channel:ch_all', picked, { signal: new AbortController().signal, onProgress: (f) => progress.push(f), size: { width: 4032, height: 3024 } }, { upload, prepare });
    await settle();
    expect(prepare).toHaveBeenCalledWith(picked, { width: 4032, height: 3024 });
    expect(calls.map((c) => c.file)).toEqual([copies.thumb, copies.main]);
    calls[1]?.progress?.(0.5);
    calls[0]?.progress?.(1);
    expect(progress).toEqual([240 / 520, 280 / 520]);
    calls[0]?.resolve({ imageKey: 'chat/channel/ch_all/thumb.jpeg' });
    calls[1]?.resolve({ imageKey: 'chat/channel/ch_all/main.jpeg' });
    await expect(job).resolves.toEqual({ imageKey: 'chat/channel/ch_all/main.jpeg', thumbKey: 'chat/channel/ch_all/thumb.jpeg', width: 2048, height: 1536 });
  });

  it('still sends the photo when only the thumbnail fails', async () => {
    const { upload, calls } = fakeUpload();
    const job = uploadChatImage('r', jpeg(10), { signal: new AbortController().signal, onProgress: () => undefined }, {
      upload,
      prepare: async (file) => ({ main: file, thumb: jpeg(2), width: null, height: null }),
    });
    await settle();
    calls[0]?.reject(new TypeError('Network request failed'));
    calls[1]?.resolve({ imageKey: 'main' });
    await expect(job).resolves.toEqual({ imageKey: 'main', thumbKey: null });
  });

  it('uploads one file when there is no thumbnail', async () => {
    const { upload, calls } = fakeUpload();
    const gif = new Blob([new Uint8Array(10)], { type: 'image/gif' });
    const job = uploadChatImage('r', gif, { signal: new AbortController().signal, onProgress: () => undefined }, {
      upload,
      prepare: async (file) => ({ main: file, thumb: null, width: null, height: null }),
    });
    await settle();
    expect(calls).toHaveLength(1);
    calls[0]?.resolve({ imageKey: 'gif' });
    await expect(job).resolves.toEqual({ imageKey: 'gif', thumbKey: null });
  });

  it('stops the thumbnail when the main upload fails, and rejects with that error', async () => {
    const { upload, calls } = fakeUpload();
    const job = uploadChatImage('r', jpeg(10), { signal: new AbortController().signal, onProgress: () => undefined }, {
      upload,
      prepare: async () => ({ main: jpeg(5), thumb: jpeg(2), width: null, height: null }),
    });
    await settle();
    const refused = new ApiClientError(400, 'too_large', '图片不能超过 8MB');
    calls[1]?.reject(refused);
    await expect(job).rejects.toBe(refused);
    expect(calls[0]?.signal?.aborted).toBe(true);
  });

  it('passes an abort on to both uploads', async () => {
    const { upload, calls } = fakeUpload();
    const controller = new AbortController();
    void uploadChatImage('r', jpeg(10), { signal: controller.signal, onProgress: () => undefined }, {
      upload,
      prepare: async () => ({ main: jpeg(5), thumb: jpeg(2), width: null, height: null }),
    }).catch(() => undefined);
    await settle();
    controller.abort();
    expect(calls[0]?.signal?.aborted).toBe(true);
    expect(calls[1]?.signal).toBe(controller.signal);
  });

  it('does not start when aborted while the copies were made', async () => {
    const { upload } = fakeUpload();
    const controller = new AbortController();
    const job = uploadChatImage('r', jpeg(10), { signal: controller.signal, onProgress: () => undefined }, {
      upload,
      prepare: async () => {
        controller.abort();
        return { main: jpeg(5), thumb: null, width: null, height: null };
      },
    });
    await expect(job).rejects.toMatchObject({ name: 'AbortError' });
    expect(upload).not.toHaveBeenCalled();
  });

  it('encodes a photo once, even when its upload is retried', async () => {
    const picked = jpeg(10);
    const prepare = vi.fn(async () => ({ main: jpeg(5), thumb: null, width: null, height: null }));
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { upload, calls } = fakeUpload();
      const job = uploadChatImage('r', picked, { signal: new AbortController().signal, onProgress: () => undefined }, { upload, prepare });
      await settle();
      calls[0]?.resolve({ imageKey: `k${attempt}` });
      await job;
    }
    expect(prepare).toHaveBeenCalledTimes(1);
  });
});

/** Enough of XMLHttpRequest for uploadWithProgress. */
/** uploadWithProgress 所需的 XMLHttpRequest 替身。 */
class FakeXhr {
  static last: FakeXhr | null = null;
  method = '';
  url = '';
  headers: Record<string, string> = {};
  status = 0;
  responseText = '';
  responseHeaders: Record<string, string> = {};
  body: unknown = null;
  upload: { onprogress: ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  constructor() {
    FakeXhr.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  getResponseHeader(name: string) {
    return this.responseHeaders[name] ?? null;
  }
  send(body: unknown) {
    this.body = body;
  }
  abort() {
    this.onabort?.();
  }
  respond(status: number, body: unknown) {
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.responseHeaders['content-type'] = 'application/json';
    this.onload?.();
  }
}

describe('uploadWithProgress', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    useSessionStore.setState({ token: null, member: null, mediaToken: null });
  });

  it('posts the bytes with their type and the session, and reports progress', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    useSessionStore.setState({ token: 'tok' });
    const progress: number[] = [];
    const file = jpeg(100);
    const job = uploadWithProgress('channel:ch_all', file, { onProgress: (f) => progress.push(f) });
    const xhr = FakeXhr.last;
    expect(xhr?.method).toBe('POST');
    expect(xhr?.url.endsWith('/chat/rooms/channel%3Ach_all/images')).toBe(true);
    expect(xhr?.headers).toEqual({ authorization: 'Bearer tok', 'content-type': 'image/jpeg' });
    expect(xhr?.body).toBe(file);
    xhr?.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
    xhr?.respond(201, { imageKey: 'k' });
    await expect(job).resolves.toEqual({ imageKey: 'k' });
    expect(progress).toEqual([0.5]);
  });

  it('reads the error envelope, and signs out on 401', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    useSessionStore.setState({ token: 'tok' });
    const refused = uploadWithProgress('r', jpeg(1));
    FakeXhr.last?.respond(400, { error: { code: 'too_large', message: '图片不能超过 8MB' } });
    await expect(refused).rejects.toMatchObject({ status: 400, code: 'too_large', message: '图片不能超过 8MB' });
    const expired = uploadWithProgress('r', jpeg(1));
    FakeXhr.last?.respond(401, { error: { code: 'unauthorized', message: '请先登录' } });
    await expect(expired).rejects.toBeInstanceOf(ApiClientError);
    expect(useSessionStore.getState().token).toBeNull();
  });

  it('rejects a network failure with a TypeError and an abort with an AbortError', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const offline = uploadWithProgress('r', jpeg(1));
    FakeXhr.last?.onerror?.();
    await expect(offline).rejects.toBeInstanceOf(TypeError);
    const controller = new AbortController();
    const stopped = uploadWithProgress('r', jpeg(1), { signal: controller.signal });
    controller.abort();
    await expect(stopped).rejects.toMatchObject({ name: 'AbortError' });
  });
});
