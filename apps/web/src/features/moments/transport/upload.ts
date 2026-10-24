import type { ApiError, UploadedMedia } from '@utmmsc/shared';
import { API_BASE_URL } from '../../../shared/api/config';
import { ApiClientError } from '../../../shared/api/errors';
import { useSessionStore } from '../../../shared/session/store';

export interface MomentUploadOptions {
  signal?: AbortSignal;
  /** 0 to 1 as the bytes go out. */
  /** 字节发出时的进度，0 到 1。 */
  onProgress?: (fraction: number) => void;
  /**
   * Defaults to the blob's own type. Pass it when the picker left the type empty, as some Android galleries do
   * for videos, or for a preview made on a canvas ('image/jpeg').
   * 默认使用 blob 自身的类型。选择器没有给出类型时（部分安卓相册对视频如此），或者上传画布生成的预览图（'image/jpeg'）时传入。
   */
  contentType?: string;
}

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
 * Uploads one photo, video or preview for a moment to POST /members/me/media with XMLHttpRequest, because fetch
 * cannot report upload progress. Resolves with the stored key, which goes into CreateMomentBody.media (key, or
 * previewKey for a preview). The server records the upload, and its daily sweep deletes it when no post uses it.
 * Network failures reject with a TypeError, so errorMessage() shows the offline text; an abort rejects with an
 * AbortError DOMException.
 * 用 XMLHttpRequest 把动态的一张照片、一个视频或一张预览图上传到 POST /members/me/media，因为 fetch 无法报告上传进度。
 * 返回保存后的键，放进 CreateMomentBody.media（key，预览图放在 previewKey）。服务器会记录这次上传，没有动态使用时由每天的清理任务删除。
 * 网络失败以 TypeError 拒绝，errorMessage() 会显示离线提示；中止时以 AbortError 的 DOMException 拒绝。
 */
export function uploadMomentMedia(file: Blob, options: MomentUploadOptions = {}): Promise<UploadedMedia> {
  const { signal, onProgress } = options;
  const contentType = options.contentType || file.type;
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const xhr = new XMLHttpRequest();
    const onAbort = () => xhr.abort();
    const cleanup = () => signal?.removeEventListener('abort', onAbort);

    xhr.open('POST', `${API_BASE_URL}/members/me/media`);
    const token = useSessionStore.getState().token;
    if (token) xhr.setRequestHeader('authorization', `Bearer ${token}`);
    if (contentType) xhr.setRequestHeader('content-type', contentType);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress?.(Math.min(1, event.loaded / event.total));
    };
    xhr.onload = () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const media = JSON.parse(xhr.responseText) as UploadedMedia;
          onProgress?.(1);
          resolve(media);
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

/** True for an AbortError from cancel(); it is not a failure to show. */
/** cancel() 引起的 AbortError 为 true；这不是需要显示的失败。 */
export function isUploadAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/**
 * True for an upload error worth trying again with backoff: the network failed, the server was busy or briefly
 * down (429, 5xx), or the request timed out. A refusal of the file itself (too large, wrong type, 400) is not.
 * 值得退避后再试的上传错误为 true：网络失败、服务器繁忙或暂时不可用（429、5xx），或请求超时。文件本身被拒绝（过大、类型不对、400）则不是。
 */
export function isRetryableUploadError(error: unknown): boolean {
  if (isUploadAbort(error)) return false;
  if (error instanceof TypeError) return true;
  if (error instanceof ApiClientError) return error.status === 408 || error.status === 429 || error.status >= 500;
  return false;
}
