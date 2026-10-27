import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StickerAddResponse } from '@utmmsc/shared';
import { ApiClientError } from '../../../shared/api/errors';
import { useSessionStore } from '../../../shared/session/store';
import { STICKER_UPLOAD_STALL_MS, stickerUploadBody, stickerUploadHeader, uploadSticker, type StickerUploadInput } from './upload';

const SHA = 'a'.repeat(64);
const THUMB_SHA = 'b'.repeat(64);

function input(): StickerUploadInput {
  return {
    file: new Blob([Uint8Array.from([1, 2, 3, 4, 5])], { type: 'image/gif' }),
    thumb: new Blob([Uint8Array.from([9, 8, 7])], { type: 'image/webp' }),
    sha256: SHA,
    thumbSha256: THUMB_SHA,
  };
}

const response: StickerAddResponse = {
  sticker: { id: `stk_${'A'.repeat(22)}`, type: 'gif', width: 10, height: 10, animated: true, bytes: 5, thumb: 'T'.repeat(22), addedAt: '2026-10-26T12:00:00.000Z' },
  duplicate: false,
  total: 1,
  version: 4,
};

/** Enough of XMLHttpRequest for uploadSticker. */
/** uploadSticker 所需的 XMLHttpRequest 替身。 */
class FakeXhr {
  static last: FakeXhr | null = null;
  method = '';
  url = '';
  headers: Record<string, string> = {};
  status = 0;
  responseText = '';
  responseHeaders: Record<string, string> = {};
  body: unknown = null;
  aborts = 0;
  upload: {
    onprogress: ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null;
    onload: (() => void) | null;
  } = { onprogress: null, onload: null };
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
    this.aborts += 1;
    this.onabort?.();
  }
  respond(status: number, body: unknown) {
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.responseHeaders['content-type'] = 'application/json';
    this.onload?.();
  }
}

describe('sticker upload body and header', () => {
  it('sends the still first, then the file, and names both hashes and the still length', async () => {
    const parts = input();
    const body = stickerUploadBody(parts);
    expect([...new Uint8Array(await body.arrayBuffer())]).toEqual([9, 8, 7, 1, 2, 3, 4, 5]);
    expect(stickerUploadHeader(parts)).toBe(`${SHA}.${THUMB_SHA}.3`);
    expect(stickerUploadHeader(parts)).toMatch(/^([0-9a-f]{64})\.([0-9a-f]{64})\.([1-9][0-9]{0,5})$/);
  });
});

describe('uploadSticker', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    useSessionStore.setState({ token: null, member: null, mediaToken: null });
  });

  it('posts the raw body with the x-sticker header and the session, and reports progress', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    useSessionStore.setState({ token: 'tok' });
    const progress: number[] = [];
    const job = uploadSticker(input(), { onProgress: (f) => progress.push(f) });
    const xhr = FakeXhr.last;
    expect(xhr?.method).toBe('POST');
    expect(xhr?.url.endsWith('/stickers/upload')).toBe(true);
    expect(xhr?.headers).toEqual({ authorization: 'Bearer tok', 'content-type': 'application/octet-stream', 'x-sticker': `${SHA}.${THUMB_SHA}.3` });
    expect(xhr?.body).toBeInstanceOf(Blob);
    expect([...new Uint8Array(await (xhr?.body as Blob).arrayBuffer())]).toEqual([9, 8, 7, 1, 2, 3, 4, 5]);
    xhr?.upload.onprogress?.({ lengthComputable: true, loaded: 4, total: 8 });
    xhr?.respond(201, response);
    await expect(job).resolves.toEqual({ status: 201, body: response });
    expect(progress).toEqual([0.5]);
  });

  it('gives the status of a duplicate', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const job = uploadSticker(input());
    FakeXhr.last?.respond(200, { ...response, duplicate: true });
    await expect(job).resolves.toMatchObject({ status: 200, body: { duplicate: true } });
  });

  it('reads the error envelope, and signs out on 401', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    useSessionStore.setState({ token: 'tok' });
    const refused = uploadSticker(input());
    FakeXhr.last?.respond(409, { error: { code: 'sticker_full', message: '最多添加 999 个表情，请先删除一些' } });
    await expect(refused).rejects.toMatchObject({ status: 409, code: 'sticker_full', message: '最多添加 999 个表情，请先删除一些' });
    const expired = uploadSticker(input());
    FakeXhr.last?.respond(401, { error: { code: 'unauthorized', message: '请先登录' } });
    await expect(expired).rejects.toBeInstanceOf(ApiClientError);
    expect(useSessionStore.getState().token).toBeNull();
  });

  it('rejects a network failure with a TypeError and an abort with an AbortError', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const offline = uploadSticker(input());
    FakeXhr.last?.onerror?.();
    await expect(offline).rejects.toBeInstanceOf(TypeError);
    const controller = new AbortController();
    const stopped = uploadSticker(input(), { signal: controller.signal });
    controller.abort();
    await expect(stopped).rejects.toMatchObject({ name: 'AbortError' });
    await expect(uploadSticker(input(), { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });

  describe('when the upload stalls', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.stubGlobal('XMLHttpRequest', FakeXhr);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('gives up as a network failure when nothing more is sent for 30 s, each byte sent starting the wait again', async () => {
      const job = uploadSticker(input());
      const outcome = job.catch((error: unknown) => error);
      const xhr = FakeXhr.last;
      vi.advanceTimersByTime(STICKER_UPLOAD_STALL_MS - 1000);
      xhr?.upload.onprogress?.({ lengthComputable: true, loaded: 3, total: 8 });
      vi.advanceTimersByTime(STICKER_UPLOAD_STALL_MS - 1000);
      // The same count again is no progress, so it does not start the wait again.
      // 相同的字节数不算进度，因此不会重新开始等待。
      xhr?.upload.onprogress?.({ lengthComputable: true, loaded: 3, total: 8 });
      expect(xhr?.aborts).toBe(0);
      vi.advanceTimersByTime(1000);
      expect(xhr?.aborts).toBe(1);
      const error = await outcome;
      expect(error).toBeInstanceOf(TypeError);
      expect(error).not.toMatchObject({ name: 'AbortError' });
    });

    it('counts a body the browser starts sending over again as progress', async () => {
      const job = uploadSticker(input());
      const outcome = job.catch((error: unknown) => error);
      const xhr = FakeXhr.last;
      xhr?.upload.onprogress?.({ lengthComputable: true, loaded: 6, total: 8 });
      vi.advanceTimersByTime(STICKER_UPLOAD_STALL_MS - 1000);
      xhr?.upload.onprogress?.({ lengthComputable: true, loaded: 2, total: 8 });
      vi.advanceTimersByTime(STICKER_UPLOAD_STALL_MS - 1000);
      xhr?.upload.onprogress?.({ lengthComputable: true, loaded: 4, total: 8 });
      vi.advanceTimersByTime(STICKER_UPLOAD_STALL_MS - 1000);
      expect(xhr?.aborts).toBe(0);
      xhr?.respond(201, response);
      await expect(outcome).resolves.toEqual({ status: 201, body: response });
    });

    it('gives up as a network failure when no response comes 30 s after the body is sent', async () => {
      const job = uploadSticker(input());
      const outcome = job.catch((error: unknown) => error);
      const xhr = FakeXhr.last;
      xhr?.upload.onprogress?.({ lengthComputable: true, loaded: 8, total: 8 });
      vi.advanceTimersByTime(STICKER_UPLOAD_STALL_MS - 1000);
      xhr?.upload.onload?.();
      vi.advanceTimersByTime(STICKER_UPLOAD_STALL_MS - 1);
      expect(xhr?.aborts).toBe(0);
      vi.advanceTimersByTime(1);
      expect(xhr?.aborts).toBe(1);
      expect(await outcome).toBeInstanceOf(TypeError);
    });

    it('stops waiting once answered, failed or aborted by the caller', async () => {
      const done = uploadSticker(input());
      const answered = FakeXhr.last;
      answered?.respond(201, response);
      await expect(done).resolves.toEqual({ status: 201, body: response });

      const failed = uploadSticker(input());
      const offline = FakeXhr.last;
      offline?.onerror?.();
      await expect(failed).rejects.toBeInstanceOf(TypeError);

      const controller = new AbortController();
      const stopped = uploadSticker(input(), { signal: controller.signal });
      const cancelled = FakeXhr.last;
      controller.abort();
      await expect(stopped).rejects.toMatchObject({ name: 'AbortError' });
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(STICKER_UPLOAD_STALL_MS * 2);
      expect([answered?.aborts, offline?.aborts, cancelled?.aborts]).toEqual([0, 0, 1]);
    });
  });
});
