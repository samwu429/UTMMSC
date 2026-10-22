const STYLE = `
  body { margin: 0; background: #F2F3F5; color: #2C2140; font-family: Georgia, "Times New Roman", serif; }
  main { max-width: 640px; margin: 0 auto; padding: 48px 20px 64px; }
  .sheet { background: #fff; border: 1px solid #E4E0D8; padding: 36px 32px 32px; }
  img { display: block; width: min(100%, 420px); height: auto; }
  .gold { height: 3px; background: #FFD23F; margin-top: 20px; }
  .rule { height: 1px; background: #5B2A86; }
  h1 { margin: 28px 0 8px; font-weight: normal; font-size: 32px; line-height: 1.25; color: #3C165F; }
  .en { margin: 0; color: #5B2A86; font-size: 15px; line-height: 1.5; }
  p { margin: 22px 0 0; font-size: 17px; line-height: 1.7; }
  .actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 28px; }
  .actions a { display: inline-block; padding: 12px 18px; font-size: 16px; text-decoration: none; }
  a.enter { background: #5B2A86; color: #fff; }
  a.android { padding: 11px 17px; border: 1px solid #5B2A86; background: #fff; color: #3C165F; }
  a.android span { color: #5B2A86; font-size: 13px; }
  p.note { margin-top: 20px; font-size: 15px; line-height: 1.7; color: #4A4155; }
  p.note.en { margin-top: 6px; color: #5B2A86; font-size: 14px; }
  footer { margin-top: 28px; color: #6B6570; font-size: 13px; line-height: 1.6; }
`;

function page({ title, head = '', body }: { title: string; head?: string; body: string }): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#3C165F">
<title>${title}</title>
${head}<link rel="icon" href="/UTMMSC/brand/icon.svg">
<style>${STYLE}</style>
</head>
<body>
<main>
  <div class="sheet">
    <img src="/UTMMSC/brand/logo-horizontal.svg" alt="UTMMSC · Mandarin Scholars Coalition">
    <div class="gold"></div>
    <div class="rule"></div>
${body}
    <footer>多伦多大学密西沙加校区国语学者联盟</footer>
  </div>
</main>
</body>
</html>`;
}

export const HOME = page({
  title: 'UTMMSC 国语学者联盟',
  head: `<meta name="description" content="多伦多大学密西沙加校区国语学者联盟。">
<link rel="canonical" href="https://utmmsc.com/">
`,
  body: `    <h1>国语学者联盟</h1>
    <p class="en">University of Toronto Mississauga<br>Mandarin Scholars Coalition</p>
    <p>官网正在准备。成员请从成员网络进入。</p>
    <div class="actions">
      <a class="enter" href="/UTMMSC/">进入成员网络</a>
      <a class="android" href="/download/android">安卓端下载 <span lang="en">Download for Android</span></a>
    </div>
    <p class="note">iPhone 请使用网页版：用 Safari 打开成员网络，点「分享」，再选「添加到主屏幕」。App 和网页版是同一个账号，消息互通。</p>
    <p class="note en" lang="en">On iPhone, use the web version: open it in Safari, tap Share, then Add to Home Screen. The app and the website share one account and the same messages.</p>`,
});

export const ANDROID_MISSING = page({
  title: '安卓端下载 · UTMMSC',
  head: `<meta name="robots" content="noindex">
`,
  body: `    <h1>安卓安装包暂未发布</h1>
    <p class="en" lang="en">The Android app is not available yet.</p>
    <p>请先使用网页版，安卓手机和 iPhone 都可以直接打开。</p>
    <p class="note en" lang="en">Please use the web version for now. It works on Android phones and iPhone.</p>
    <div class="actions">
      <a class="enter" href="/UTMMSC/">进入成员网络</a>
      <a class="android" href="/">返回首页 <span lang="en">Home</span></a>
    </div>`,
});
