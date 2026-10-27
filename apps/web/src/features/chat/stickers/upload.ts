import type { ApiError, StickerAddResponse } from '@utmmsc/shared';
import { API_BASE_URL } from '../../../shared/api/config';
import { ApiClientError } from '../../../shared/api/errors';
import { useSessionStore } from '../../../shared/session/store';

/** What one upload needs from a prepared sticker. */
/** 一次上传需要从已处理的表情中取得的内容。 */
export interface StickerUploadInput {
  file: Blob;
  thumb: Blob;
  sha256: string;
  thumbSha256: string;
}

export interface StickerUploadResult {
  /** 201 when added, 200 when the member already had it (moved to the front). */
  /** 新添加时为 201；成员已有这个表情（已移到最前）时为 200。 */
  status: number;
  body: StickerAddResponse;
}

/**
 * The x-sticker header: the sticker's SHA-256, the still's SHA-256 and the still's byte length, so the route can split
 * the raw body (still first) without parsing a form.
 * x-sticker 请求头：表情的 SHA-256、静态图的 SHA-256 和静态图的字节数，接口据此拆分原始请求体（静态图在前），不必解析表单。
 */
export function stickerUploadHeader(input: StickerUploadInput): string {
  return `${input.sha256}.${input.thumbSha256}.${input.thumb.size}`;
}

/** The body: the still's bytes followed by the sticker's. */
/** 请求体：静态图的字节，后面紧跟表情的字节。 */
export function stickerUploadBody(input: StickerUploadInput): Blob {
  return new Blob([input.thumb, input.file], { type: 'application/octet-stream' });
}

/**
 * An upload that sends nothing more for this long, or gets no response this long after the body is sent, is given up
 * as a network failure: uploads run one at a time, so a silent stall would hold back every later one.
 * 上传超过这么久没有任何进度，或者请求体发出后这么久仍没有响应，就按网络失败放弃：上传逐个进行，无声的卡住会拖住之后所有的上传。
 */
export const STICKER_UPLOAD_STALL_MS = 30_000;

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
 * Uploads one prepared sticker to POST /stickers/upload with XMLHttpRequest, because fetch cannot report upload
 * progress. A network failure, a stall included (STICKER_UPLOAD_STALL_MS), rejects with a TypeError, so errorMessage()
 * shows the offline text; a refusal rejects with ApiClientError carrying the server's code and message; an abort
 * through the signal rejects with an AbortError.
 * 用 XMLHttpRequest 把一个已处理的表情上传到 POST /stickers/upload，因为 fetch 无法报告上传进度。网络失败（包括卡住，见
 * STICKER_UPLOAD_STALL_MS）以 TypeError 拒绝，errorMessage() 因此显示离线提示；服务端拒绝时以带有服务端代码和提示的
 * ApiClientError 拒绝；通过 signal 中止时以 AbortError 拒绝。
 */
export function uploadSticker(
  prepared: StickerUploadInput,
  options: { signal?: AbortSignal; onProgress?: (fraction: number) => void } = {},
): Promise<StickerUploadResult> {
  const { signal, onProgress } = options;
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const xhr = new XMLHttpRequest();
    const onAbort = () => xhr.abort();
    // Set when the stall timer gave up, so the abort it causes reads as a network failure, not as the caller's.
    // 卡住计时器放弃时设置，它引起的中止因此按网络失败处理，而不是调用方的中止。
    let stalled = false;
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    let sent = 0;
    // (Re)starts the stall timer: on send, whenever the count of bytes sent changes, and once the body is out.
    // （重新）启动卡住计时器：发送时、已发出的字节数每次变化时，以及请求体全部发出时。
    const watch = () => {
      if (watchdog !== null) clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        stalled = true;
        xhr.abort();
      }, STICKER_UPLOAD_STALL_MS);
    };
    const cleanup = () => {
      if (watchdog !== null) clearTimeout(watchdog);
      watchdog = null;
      signal?.removeEventListener('abort', onAbort);
    };

    xhr.open('POST', `${API_BASE_URL}/stickers/upload`);
    const token = useSessionStore.getState().token;
    if (token) xhr.setRequestHeader('authorization', `Bearer ${token}`);
    xhr.setRequestHeader('content-type', 'application/octet-stream');
    xhr.setRequestHeader('x-sticker', stickerUploadHeader(prepared));

    xhr.upload.onprogress = (event) => {
      // A smaller count is the browser sending the body over again (a retried connection), which is progress too.
      // 字节数变小说明浏览器正在重新发送请求体（连接重试），这同样算作进度。
      if (event.loaded !== sent) {
        sent = event.loaded;
        watch();
      }
      if (event.lengthComputable && event.total > 0) onProgress?.(event.loaded / event.total);
    };
    // The whole body is out: from here the deadline is for the response.
    // 请求体已全部发出：此后的期限是等待响应的期限。
    xhr.upload.onload = watch;
    xhr.onload = () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve({ status: xhr.status, body: JSON.parse(xhr.responseText) as StickerAddResponse });
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
      reject(stalled ? new TypeError('Network request failed') : abortError());
    };
    signal?.addEventListener('abort', onAbort);
    xhr.send(stickerUploadBody(prepared));
    watch();
  });
}
