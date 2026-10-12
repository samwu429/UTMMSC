import type { MailMessage } from './brevo';

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);
}

function wrap(title: string, bodyHtml: string): string {
  return `<!doctype html><html lang="zh"><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111">
<h2 style="margin:0 0 16px">${escapeHtml(title)}</h2>${bodyHtml}
<p style="margin-top:32px;color:#666;font-size:12px">UTMMSC 成员网络</p></body></html>`;
}

export function verificationCodeMail(to: string, code: string, purpose: 'register' | 'reset'): MailMessage {
  const action = purpose === 'register' ? '注册' : '重置密码';
  const subject = `UTMMSC ${action}验证码：${code}`;
  const text = `你的 UTMMSC ${action}验证码是 ${code}，10 分钟内有效。如果不是你本人操作，请忽略这封邮件。`;
  const html = wrap(
    `${action}验证码`,
    `<p>你的验证码：</p><p style="font-size:32px;letter-spacing:8px;font-weight:600">${code}</p><p>10 分钟内有效。如果不是你本人操作，请忽略这封邮件。</p>`,
  );
  return { to: [{ email: to }], subject, text, html };
}

export function applicationApprovedMail(to: string, displayName: string, appBaseUrl: string): MailMessage {
  const link = `${appBaseUrl}register?email=${encodeURIComponent(to)}&approved=1`;
  const text = `${displayName}，你的 UTMMSC 成员申请已通过。请打开 ${link} 设置密码并登录。`;
  const html = wrap(
    '申请已通过',
    `<p>${escapeHtml(displayName)}，你的成员申请已通过。</p><p><a href="${link}">点击这里设置密码并登录</a></p>`,
  );
  return { to: [{ email: to, name: displayName }], subject: 'UTMMSC 成员申请已通过', text, html };
}

export function applicationRejectedMail(to: string, displayName: string): MailMessage {
  const text = `${displayName}，很抱歉，你的 UTMMSC 成员申请未通过。如有疑问请联系主席团。`;
  const html = wrap('申请未通过', `<p>${escapeHtml(displayName)}，很抱歉，你的成员申请未通过。如有疑问请联系主席团。</p>`);
  return { to: [{ email: to, name: displayName }], subject: 'UTMMSC 成员申请结果', text, html };
}

export function enrollmentYearDecisionMail(to: string, displayName: string, year: number, approved: boolean): MailMessage {
  const subject = approved ? 'UTMMSC 入学年份已更新' : 'UTMMSC 入学年份申请未通过';
  const text = approved
    ? `${displayName}，系统管理员已同意把你的入学年份改为 ${year} 年。`
    : `${displayName}，系统管理员没有同意把入学年份改为 ${year} 年。现在的年份保持不变。`;
  const html = wrap(approved ? '入学年份已更新' : '入学年份申请未通过', `<p>${escapeHtml(text)}</p>`);
  return { to: [{ email: to, name: displayName }], subject, text, html };
}

export function announcementMail(to: { email: string; name: string }[], title: string, body: string, appBaseUrl: string): MailMessage {
  const html = wrap(
    title,
    `<div style="white-space:pre-wrap">${escapeHtml(body)}</div><p style="margin-top:24px"><a href="${appBaseUrl}">打开 UTMMSC</a></p>`,
  );
  return { to, subject: `[UTMMSC 公告] ${title}`, text: `${body}\n\n${appBaseUrl}`, html };
}
