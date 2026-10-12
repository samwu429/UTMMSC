import type { MailMessage } from './brevo';

const SITE = 'https://utmmsc.com/UTMMSC/';
const SITE_LABEL = 'utmmsc.com/UTMMSC';
const LOGO = `${SITE}brand/logo-horizontal.png`;
const ORG_ZH = '多伦多大学密西沙加校区国语学者联盟';
const ORG_EN = 'University of Toronto Mississauga Mandarin Scholars Coalition';

export type LetterLang = 'zh' | 'en';

function caution(lang: LetterLang): string {
  return lang === 'en'
    ? 'This letter was sent by the UTMMSC member network. Open only links on utmmsc.com. We never ask for your password by email.'
    : '此信由 UTMMSC 成员网络发出。请只打开指向 utmmsc.com 的链接。我们不会在邮件里向你索要密码。';
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);
}

function plainLetter(title: string, paragraphs: string[], lang: LetterLang = 'zh'): string {
  return [
    'UTMMSC',
    ORG_ZH,
    ORG_EN,
    SITE,
    '',
    title,
    '',
    ...paragraphs,
    '',
    '—',
    `${ORG_ZH}（${ORG_EN}）`,
    SITE,
    caution(lang),
  ].join('\n');
}

/**
 * Stationery shared by every message: the official mark at the head and again at the close,
 * on a white sheet. The image is the SVG logo rendered for mail clients, which do not show SVG.
 * 所有邮件共用的信纸：刊头和落款都是正式标志。图片由 SVG 标志导出，因为邮件客户端不显示 SVG。
 */
function wrap(title: string, bodyHtml: string, preheader: string, lang: LetterLang = 'zh'): string {
  const safeTitle = escapeHtml(title);
  const safePreheader = escapeHtml(preheader);
  return `<!doctype html>
<html lang="${lang === 'en' ? 'en' : 'zh'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${safeTitle}</title>
</head>
<body style="margin:0;padding:0;background:#F2F3F5;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${safePreheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F2F3F5;border-collapse:collapse;">
<tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#ffffff;border:1px solid #E4E0D8;border-collapse:collapse;">
<tr><td style="padding:32px 40px 0;">
<img src="${LOGO}" width="280" alt="UTMMSC · Mandarin Scholars Coalition" style="display:block;width:280px;max-width:100%;height:auto;border:0;">
<div style="height:3px;line-height:3px;font-size:0;background:#FFD23F;margin:18px 0 0;">&nbsp;</div>
<div style="height:1px;line-height:1px;font-size:0;background:#5B2A86;">&nbsp;</div>
</td></tr>
<tr><td style="padding:28px 40px 8px;font-family:Georgia,'Times New Roman',serif;color:#2C2140;">
<p style="margin:0 0 10px;font-family:Georgia,'Times New Roman',serif;font-size:12px;letter-spacing:0.14em;color:#5B2A86;">${lang === 'en' ? 'MEMBER LETTER' : '成员信函'}</p>
<h1 style="margin:0 0 18px;font-family:Georgia,'Times New Roman',serif;font-size:26px;font-weight:normal;line-height:1.3;color:#3C165F;">${safeTitle}</h1>
<div style="font-family:Georgia,'Times New Roman',serif;font-size:16px;line-height:1.7;color:#2C2140;">${bodyHtml}</div>
</td></tr>
<tr><td style="padding:8px 40px 32px;">
<div style="height:1px;line-height:1px;font-size:0;background:#E6E2DA;margin:8px 0 22px;">&nbsp;</div>
<img src="${LOGO}" width="168" alt="UTMMSC" style="display:block;width:168px;max-width:60%;height:auto;border:0;">
<p style="margin:14px 0 0;font-family:Georgia,'Times New Roman',serif;font-size:13px;line-height:1.5;color:#3C165F;">${ORG_ZH}</p>
<p style="margin:2px 0 0;font-family:Georgia,'Times New Roman',serif;font-size:12px;line-height:1.5;color:#5B2A86;">${ORG_EN}</p>
<p style="margin:12px 0 0;font-family:Georgia,'Times New Roman',serif;font-size:12px;line-height:1.6;color:#6B6570;">
<a href="${SITE}" style="color:#5B2A86;text-decoration:underline;">${SITE_LABEL}</a><br>
${caution(lang)}
</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function linkParagraph(href: string): string {
  const safe = escapeHtml(href);
  return `<p style="margin:18px 0;"><a href="${safe}" style="color:#5B2A86;text-decoration:underline;">${safe}</a></p>`;
}

export function verificationCodeMail(to: string, code: string, purpose: 'register' | 'reset'): MailMessage {
  const action = purpose === 'register' ? '注册' : '重置密码';
  const title = `${action}验证码`;
  const subject = `UTMMSC ${title}`;
  const text = plainLetter(title, [
    `你好，`,
    `这是你的 UTMMSC ${action}验证码，请在 10 分钟内于 ${SITE} 填入：`,
    code,
    '如果不是你本人操作，请忽略这封邮件。',
  ]);
  const html = wrap(
    title,
    `<p style="margin:0 0 12px;">你好，</p>
<p style="margin:0 0 16px;">这是你的 UTMMSC ${action}验证码。请在 10 分钟内，于成员网络页面填入。请不要把验证码转发给任何人。</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 16px;border-collapse:collapse;">
<tr><td style="border:1px solid #E4E0D8;background:#F7F5F2;padding:14px 28px;font-family:Georgia,'Times New Roman',serif;font-size:28px;letter-spacing:0.35em;color:#3C165F;">${escapeHtml(code)}</td></tr>
</table>
<p style="margin:0;">如果不是你本人操作，请忽略这封邮件。</p>`,
    `你的 UTMMSC ${action}验证码将在 10 分钟后失效。`,
  );
  return { to: [{ email: to }], subject, text, html };
}

export function applicationApprovedMail(to: string, displayName: string, appBaseUrl: string): MailMessage {
  const link = `${appBaseUrl}register?email=${encodeURIComponent(to)}&approved=1`;
  const name = escapeHtml(displayName);
  const title = '成员申请已通过';
  const text = plainLetter(title, [`${displayName}，你的 UTMMSC 成员申请已通过。请打开下面的页面设置密码并登录：`, link]);
  const html = wrap(title, `<p style="margin:0 0 12px;">${name}，</p><p style="margin:0;">你的成员申请已通过。请打开下面的页面设置密码并登录。</p>${linkParagraph(link)}`, `${displayName}，你的成员申请已通过。`);
  return { to: [{ email: to, name: displayName }], subject: `UTMMSC ${title}`, text, html };
}

export function applicationRejectedMail(to: string, displayName: string): MailMessage {
  const title = '成员申请未通过';
  const text = plainLetter(title, [`${displayName}，很抱歉，你的 UTMMSC 成员申请未通过。如有疑问，请联系主席团。`]);
  const html = wrap(title, `<p style="margin:0;">${escapeHtml(displayName)}，很抱歉，你的成员申请未通过。如有疑问，请联系主席团。</p>`, `${displayName}，你的成员申请未通过。`);
  return { to: [{ email: to, name: displayName }], subject: `UTMMSC ${title}`, text, html };
}

export function enrollmentYearDecisionMail(to: string, displayName: string, year: number, approved: boolean): MailMessage {
  const title = approved ? '入学年份已更新' : '入学年份申请未通过';
  const sentence = approved
    ? `${displayName}，系统管理员已同意把你的入学年份改为 ${year} 年。`
    : `${displayName}，系统管理员没有同意把入学年份改为 ${year} 年。现在的年份保持不变。`;
  const text = plainLetter(title, [sentence]);
  const html = wrap(title, `<p style="margin:0;">${escapeHtml(sentence)}</p>`, sentence);
  return { to: [{ email: to, name: displayName }], subject: `UTMMSC ${title}`, text, html };
}

export function advisorInviteMail(to: string, link: string, lang: LetterLang = 'zh'): MailMessage {
  if (lang === 'en') {
    const title = 'External honorary advisor invitation';
    const text = plainLetter(
      title,
      [
        'You are invited to become an external honorary advisor of UTMMSC. Open the page below with the email address that received this letter and finish registration.',
        link,
        'That page can only create an external honorary advisor account. The link is valid for 14 days. If you were not expecting this letter, you can ignore it.',
      ],
      'en',
    );
    const html = wrap(
      title,
      `<p style="margin:0 0 12px;">Hello,</p>
<p style="margin:0;">You are invited to become an external honorary advisor of UTMMSC. Open the page below with the email address that received this letter and finish registration. That page can only create an external honorary advisor account. The link is valid for 14 days.</p>
${linkParagraph(link)}
<p style="margin:0;">If you were not expecting this letter, you can ignore it.</p>`,
      'You are invited to become an external honorary advisor of UTMMSC.',
      'en',
    );
    return { to: [{ email: to }], subject: `UTMMSC ${title}`, text, html };
  }
  const title = '校外荣誉顾问邀请';
  const text = plainLetter(title, [
    '你被邀请成为 UTMMSC 校外荣誉顾问。请用收到这封邮件的邮箱打开下面的页面完成注册。',
    link,
    '这个页面只能注册成校外荣誉顾问，链接 14 天内有效。如果不是你本人，请忽略这封邮件。',
  ]);
  const html = wrap(
    title,
    `<p style="margin:0 0 12px;">你好，</p>
<p style="margin:0;">你被邀请成为 UTMMSC 校外荣誉顾问。请用收到这封邮件的邮箱打开下面的页面完成注册。这个页面只能注册成校外荣誉顾问，链接 14 天内有效。</p>
${linkParagraph(link)}
<p style="margin:0;">如果不是你本人，请忽略这封邮件。</p>`,
    '你被邀请成为 UTMMSC 校外荣誉顾问。',
  );
  return { to: [{ email: to }], subject: `UTMMSC ${title}`, text, html };
}

export function announcementMail(to: { email: string; name: string }[], title: string, body: string, appBaseUrl: string): MailMessage {
  const html = wrap(
    title,
    `<div style="white-space:pre-wrap;">${escapeHtml(body)}</div>${linkParagraph(appBaseUrl)}`,
    title,
  );
  return { to, subject: `UTMMSC 公告：${title}`, text: plainLetter(title, [body, appBaseUrl]), html };
}
