import type { ApiError } from '@utmmsc/shared';
import { useSessionStore } from '../session/store';
import { API_BASE_URL } from './config';
import { ApiClientError } from './errors';

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  rawBody?: BodyInit;
  headers?: Record<string, string>;
  auth?: boolean;
  /** 'blob' for downloads, whatever content type the file was stored with. */
  /** 下载用 'blob'，不论文件存储的类型。 */
  responseType?: 'json' | 'blob';
}

/**
 * Single entry point for API calls. Attaches the bearer token, decodes the error envelope, and
 * clears the session when the server says the token is no longer valid.
 * 接口调用的唯一入口。附加 Bearer 令牌、解析错误结构，并在服务端判定令牌失效时清除会话。
 */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, rawBody, headers = {}, auth = true, responseType = 'json' } = options;
  const finalHeaders: Record<string, string> = { ...headers };
  if (auth) {
    const token = useSessionStore.getState().token;
    if (token) finalHeaders.authorization = `Bearer ${token}`;
  }
  let payload: BodyInit | undefined = rawBody;
  if (body !== undefined) {
    finalHeaders['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const response = await fetch(`${API_BASE_URL}${path}`, { method, headers: finalHeaders, body: payload });
  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get('content-type') ?? '';
  if (!response.ok) {
    let code = 'http_error';
    let message = `请求失败（${response.status}）`;
    if (contentType.includes('application/json')) {
      const data = (await response.json().catch(() => ({}))) as Partial<ApiError>;
      code = data.error?.code ?? code;
      message = data.error?.message ?? message;
    }
    if (response.status === 401 && auth) useSessionStore.getState().clear();
    throw new ApiClientError(response.status, code, message);
  }
  if (responseType === 'blob') return (await response.blob()) as T;
  if (contentType.includes('application/json')) return (await response.json()) as T;
  return (await response.blob()) as T;
}
