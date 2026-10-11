export interface MailRecipient {
  email: string;
  name?: string;
}

export interface MailMessage {
  to: MailRecipient[];
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
  const response = await fetch(BREVO_ENDPOINT, {
    method: 'POST',
    headers: {
      'api-key': config.apiKey,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      sender: { email: config.fromEmail, name: config.fromName },
      to: message.to,
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
