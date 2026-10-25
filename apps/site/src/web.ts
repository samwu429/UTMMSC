/**
 * Every path the member network does not use belongs to the public website: the msc-web Worker from the MSC-WEB
 * repository, reached through the service binding WEB. It receives the request unchanged, so its links, redirects
 * and canonical addresses stay on utmmsc.com. Without the binding (local development, or before msc-web is
 * deployed), or when it fails, the caller's fallback answers instead.
 * 成员网络不使用的所有路径都属于公开网站：即 MSC-WEB 仓库中的 msc-web Worker，通过服务绑定 WEB 访问。它原样接收请求，
 * 因此其链接、跳转和规范地址都留在 utmmsc.com。没有该绑定时（本地开发，或 msc-web 尚未部署），或调用失败时，改由调用方的备用响应应答。
 */
export interface WebEnv {
  WEB?: Fetcher;
}

export async function forwardToWeb(request: Request, env: WebEnv, fallback: () => Response): Promise<Response> {
  if (!env.WEB) return fallback();
  try {
    return await env.WEB.fetch(request);
  } catch {
    return fallback();
  }
}
