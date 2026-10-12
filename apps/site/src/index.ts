const MEMBER_PREFIX = '/UTMMSC';

interface Env {
  ASSETS: Fetcher;
}

const HOME = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#3C165F">
<title>UTMMSC 国语学者联盟</title>
<meta name="description" content="多伦多大学密西沙加校区国语学者联盟。">
<link rel="icon" href="/UTMMSC/brand/icon.svg">
<link rel="canonical" href="https://utmmsc.com/">
<style>
  body { margin: 0; background: #F2F3F5; color: #2C2140; font-family: Georgia, "Times New Roman", serif; }
  main { max-width: 640px; margin: 0 auto; padding: 48px 20px 64px; }
  .sheet { background: #fff; border: 1px solid #E4E0D8; padding: 36px 32px 32px; }
  img { display: block; width: min(100%, 420px); height: auto; }
  .gold { height: 3px; background: #FFD23F; margin-top: 20px; }
  .rule { height: 1px; background: #5B2A86; }
  h1 { margin: 28px 0 8px; font-weight: normal; font-size: 32px; line-height: 1.25; color: #3C165F; }
  .en { margin: 0; color: #5B2A86; font-size: 15px; line-height: 1.5; }
  p { margin: 22px 0 0; font-size: 17px; line-height: 1.7; }
  a.enter { display: inline-block; margin-top: 28px; padding: 12px 18px; background: #5B2A86; color: #fff; text-decoration: none; font-size: 16px; }
  footer { margin-top: 28px; color: #6B6570; font-size: 13px; line-height: 1.6; }
</style>
</head>
<body>
<main>
  <div class="sheet">
    <img src="/UTMMSC/brand/logo-horizontal.svg" alt="UTMMSC · Mandarin Scholars Coalition">
    <div class="gold"></div>
    <div class="rule"></div>
    <h1>国语学者联盟</h1>
    <p class="en">University of Toronto Mississauga<br>Mandarin Scholars Coalition</p>
    <p>官网正在准备。成员请从成员网络进入。</p>
    <a class="enter" href="/UTMMSC/">进入成员网络</a>
    <footer>多伦多大学密西沙加校区国语学者联盟</footer>
  </div>
</main>
</body>
</html>`;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.hostname === 'www.utmmsc.com') {
      url.hostname = 'utmmsc.com';
      return Response.redirect(url.toString(), 301);
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(HOME, {
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' },
      });
    }
    if (url.pathname === MEMBER_PREFIX) {
      return Response.redirect(`${url.origin}${MEMBER_PREFIX}/${url.search}`, 301);
    }
    if (url.pathname.startsWith(`${MEMBER_PREFIX}/`)) return memberAsset(request, env, url);
    return new Response('未找到', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  },
};

async function memberAsset(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
  }
  const pathname = url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname;
  const asset = await fetchAsset(request, env, pathname);
  if (asset.status !== 404 || pathHasExtension(pathname)) return asset;
  const index = await fetchAsset(request, env, `${MEMBER_PREFIX}/index.html`);
  return new Response(index.body, { status: index.status === 200 ? 200 : index.status, headers: index.headers });
}

function fetchAsset(request: Request, env: Env, pathname: string): Promise<Response> {
  const assetUrl = new URL(request.url);
  assetUrl.pathname = pathname;
  return env.ASSETS.fetch(new Request(assetUrl, request));
}

function pathHasExtension(pathname: string): boolean {
  const last = pathname.split('/').pop() ?? '';
  return last.includes('.');
}
