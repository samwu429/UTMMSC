/** Path the member app is served under, matching the router basename. */
/** 成员应用的路径前缀，与路由的 basename 一致。 */
export const APP_BASE_PATH = '/UTMMSC/';

/**
 * Router path for a notification link. Links name the production app; only the path matters, so the
 * same link works on any host and inside the Android app. Anything outside the app gives null.
 * 通知链接对应的路由路径。链接写的是线上应用的地址；只看路径，所以同一个链接在任何主机和安卓 App 内都能用。应用以外的地址返回 null。
 */
export function appPathFromUrl(raw: unknown, basePath: string = APP_BASE_PATH): string | null {
  if (typeof raw !== 'string' || !raw) return null;
  let url: URL;
  try {
    url = new URL(raw, 'https://utmmsc.com');
  } catch {
    return null;
  }
  const base = basePath.endsWith('/') ? basePath : `${basePath}/`;
  const root = base.slice(0, -1);
  if (url.pathname !== root && !url.pathname.startsWith(base)) return null;
  const rest = url.pathname.slice(root.length) || '/';
  return `${rest}${url.search}${url.hash}`;
}

/** Room id when the router path is a conversation (not its info page), else null. */
/** 路由路径为会话页（不是资料页）时返回房间 id，否则返回 null。 */
export function roomIdFromPath(path: string): string | null {
  const match = /^\/chat\/room\/([^/?#]+)\/?(?:[?#].*)?$/.exec(path);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}
