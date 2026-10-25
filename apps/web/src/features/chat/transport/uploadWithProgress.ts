import type { ApiError, ChatImageUploadResponse } from '@utmmsc/shared';
import { API_BASE_URL } from '../../../shared/api/config';
import { ApiClientError } from '../../../shared/api/errors';
import { useSessionStore } from '../../../shared/session/store';
import { prepareChatUpload, type ChatUpload, type ImageSize } from '../composer/imagePrep';

function abortError(): DOMException {
  return new DOMException('Upload aborted', 'AbortError');
}

/** Reads the error envelope the same way the fetch client does. */
/** 与 fetch 客户端相同的方式解析错误结构。 */
function toApiError(xhr: XMLHttpRequest): ApiClientError {
  let code = 'http_error';
  let message = `请求失败（${xhr.status}）`;
  if ((xhr.getResponseHeader('content-type') ?? '').includes('application/json')) {
    try {
      const data = JSON.parse(xhr.responseText) as Partial<ApiError>;
      code = data.error?.code ?? code;
      message = data.error?.message ?? message;
    } catch {
      // Keep the generic message when the body is not valid JSON.
      // 响应体不是有效 JSON 时保留通用提示。
    }
  }
  return new ApiClientError(xhr.status, code, message);
}

/**
 * Uploads a chat image with XMLHttpRequest, because fetch cannot report upload progress.
 * Network failures reject with a TypeError so errorMessage() shows the offline text.
 * 用 XMLHttpRequest 上传聊天图片，因为 fetch 无法报告上传进度。网络失败以 TypeError 拒绝，errorMessage() 会显示离线提示。
 */
export function uploadWithProgress(
  roomId: string,
  file: Blob,
  options: { signal?: AbortSignal; onProgress?: (fraction: number) => void } = {},
): Promise<ChatImageUploadResponse> {
  const { signal, onProgress } = options;
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const xhr = new XMLHttpRequest();
    const onAbort = () => xhr.abort();
    const cleanup = () => signal?.removeEventListener('abort', onAbort);

    xhr.open('POST', `${API_BASE_URL}/chat/rooms/${encodeURIComponent(roomId)}/images`);
    const token = useSessionStore.getState().token;
    if (token) xhr.setRequestHeader('authorization', `Bearer ${token}`);
    xhr.setRequestHeader('content-type', file.type);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as ChatImageUploadResponse);
        } catch {
          reject(new ApiClientError(xhr.status, 'http_error', `请求失败（${xhr.status}）`));
        }
        return;
      }
      if (xhr.status === 401) useSessionStore.getState().clear();
      reject(toApiError(xhr));
    };
    xhr.onerror = () => {
      cleanup();
      reject(new TypeError('Network request failed'));
    };
    xhr.onabort = () => {
      cleanup();
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort);
    xhr.send(file);
  });
}

/** What the outbox gets back for one photo: the stored keys and, when the photo was re-encoded, its new size. */
/** 一张照片上传后发送队列得到的结果：存储键，以及照片重新编码后的新尺寸。 */
export interface UploadedChatImage {
  imageKey: string;
  thumbKey: string | null;
  width?: number;
  height?: number;
}

export interface ChatImageUploadOptions {
  signal: AbortSignal;
  onProgress(fraction: number): void;
  /** The photo's size as the composer read it, so a photo no larger than a thumbnail skips the resize. */
  /** 输入框读到的照片尺寸，不大于缩略图的照片因此跳过缩放。 */
  size?: ImageSize | null;
}

/** Bytes sent across several parallel uploads, as one fraction of all their bytes. */
/** 多个并行上传已发送的字节数，折算为全部字节中的比例。 */
export function combinedProgress(parts: readonly { loaded: number; total: number }[]): number {
  const total = parts.reduce((sum, part) => sum + Math.max(0, part.total), 0);
  if (total <= 0) return 0;
  const loaded = parts.reduce((sum, part) => sum + Math.min(Math.max(0, part.loaded), Math.max(0, part.total)), 0);
  return loaded / total;
}

/**
 * Prepared copies per picked file, so an upload retried after a network failure does not encode again. The outbox
 * holds the file for as long as the item lives, which is as long as the entry is needed.
 * 每个所选文件的已生成副本；网络失败后重试上传时无需再次编码。发送队列在该项存在期间一直持有文件，记录也就只在需要时存在。
 */
const prepared = new WeakMap<Blob, Promise<ChatUpload>>();

function preparedFor(file: Blob, size: ImageSize | null | undefined, prepare: typeof prepareChatUpload): Promise<ChatUpload> {
  let job = prepared.get(file);
  if (!job) {
    job = prepare(file, size);
    prepared.set(file, job);
  }
  return job;
}

/**
 * Uploads a chat photo: the 2048px copy and its 360px thumbnail go to the room's image endpoint in parallel, and the
 * progress counts both. The thumbnail is optional; if its upload fails, the photo is still sent, without one. Rejects
 * as uploadWithProgress does when the main image fails.
 * 上传一张聊天照片：2048px 的副本和 360px 的缩略图并行上传到房间的图片接口，进度同时计入两者。缩略图是可选的；
 * 它上传失败时照片仍会发送，只是不带缩略图。主图失败时与 uploadWithProgress 一样拒绝。
 */
export async function uploadChatImage(
  roomId: string,
  file: Blob,
  options: ChatImageUploadOptions,
  deps: { upload?: typeof uploadWithProgress; prepare?: typeof prepareChatUpload } = {},
): Promise<UploadedChatImage> {
  const upload = deps.upload ?? uploadWithProgress;
  const { signal, onProgress } = options;
  const copies = await preparedFor(file, options.size, deps.prepare ?? prepareChatUpload);
  if (signal.aborted) throw abortError();
  const parts = [{ loaded: 0, total: copies.main.size }];
  if (copies.thumb) parts.push({ loaded: 0, total: copies.thumb.size });
  const report = () => onProgress(combinedProgress(parts));
  const thumbAbort = new AbortController();
  const stopThumb = () => thumbAbort.abort();
  signal.addEventListener('abort', stopThumb);
  try {
    const thumbJob = copies.thumb
      ? upload(roomId, copies.thumb, {
          signal: thumbAbort.signal,
          onProgress: (fraction) => {
            const part = parts[1];
            if (part) part.loaded = fraction * part.total;
            report();
          },
        }).then(
          (res) => res.imageKey,
          () => null,
        )
      : Promise.resolve(null);
    let main;
    try {
      main = await upload(roomId, copies.main, {
        signal,
        onProgress: (fraction) => {
          const part = parts[0];
          if (part) part.loaded = fraction * part.total;
          report();
        },
      });
    } catch (error) {
      thumbAbort.abort();
      throw error;
    }
    const thumbKey = await thumbJob;
    const result: UploadedChatImage = { imageKey: main.imageKey, thumbKey };
    if (copies.width !== null && copies.height !== null) {
      result.width = copies.width;
      result.height = copies.height;
    }
    return result;
  } finally {
    signal.removeEventListener('abort', stopThumb);
  }
}
