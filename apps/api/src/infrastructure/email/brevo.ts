export interface MailRecipient {
  email: string;
  name?: string;
}

export interface MailMessage {
  to: MailRecipient[];
  /**
   * Give each recipient their own copy, so nobody sees the other addresses. Without it every `to` address goes
   * into one message's visible To line, which is only right for a single recipient. Brevo takes up to 1000
   * versions per call, so callers keep their batches well under that.
   * 每位收件人各收一份，谁都看不到别人的地址。不设置时所有 `to` 地址都在同一封邮件可见的收件人栏里，只适合单个收件人。
   * Brevo 每次请求最多接受 1000 个版本，调用方的分批要远小于这个数。
   */
  separate?: boolean;
  subject: string;
  text: string;
  html: string;
}

export interface MailConfig {
  apiKey: string | undefined;
  fromEmail: string;
  fromName: string;
}

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

/**
 * Sends through Brevo's transactional API. Without an API key (local development) the message is
 * logged instead, so sign-up flows remain testable offline.
 * 通过 Brevo 事务邮件接口发送。没有 API key 时（本地开发）改为打印日志，便于离线测试注册流程。
 */
export async function sendMail(config: MailConfig, message: MailMessage): Promise<boolean> {
  if (!config.apiKey) {
    console.log(`[mail:dry-run] to=${message.to.map((r) => r.email).join(',')} subject=${message.subject}\n${message.text}`);
    return true;
  }
  // One version per recipient, each with a To of one; Brevo then must not get a top-level `to`.
  // 每位收件人一个版本，每个版本的收件人只有一位；此时不能再向 Brevo 传顶层的 `to`。
  const recipients = message.separate ? { messageVersions: message.to.map((r) => ({ to: [r] })) } : { to: message.to };
  const response = await fetch(BREVO_ENDPOINT, {
    method: 'POST',
    headers: {
      'api-key': config.apiKey,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      sender: { email: config.fromEmail, name: config.fromName },
      ...recipients,
      subject: message.subject,
      textContent: message.text,
      htmlContent: message.html,
    }),
  });
  if (!response.ok) {
    console.error(`[mail] brevo responded ${response.status}`);
    return false;
  }
  return true;
}
