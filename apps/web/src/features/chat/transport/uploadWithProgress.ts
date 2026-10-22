import type { ApiError, ChatImageUploadResponse } from '@utmmsc/shared';
import { API_BASE_URL } from '../../../shared/api/config';
import { ApiClientError } from '../../../shared/api/errors';
import { useSessionStore } from '../../../shared/session/store';

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
