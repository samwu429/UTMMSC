import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendMail, type MailConfig, type MailMessage } from './brevo';
import { announcementMail, verificationCodeMail } from './templates';

const config: MailConfig = { apiKey: 'test-key', fromEmail: 'noreply@utmmsc.com', fromName: 'UTMMSC' };

/** Sends through a stubbed fetch and returns the JSON body Brevo would have received. */
/** 通过替换后的 fetch 发送，返回 Brevo 将收到的 JSON 请求体。 */
async function bodySent(message: MailMessage): Promise<Record<string, unknown>> {
  const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response('{}', { status: 201 }));
  vi.stubGlobal('fetch', fetchMock);
  expect(await sendMail(config, message)).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const init = fetchMock.mock.calls[0]?.[1];
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('sendMail', () => {
  it('gives every announcement recipient their own copy, so nobody sees the others', async () => {
    const members = [
      { email: 'a@mail.utoronto.ca', name: 'A' },
      { email: 'b@mail.utoronto.ca', name: 'B' },
      { email: 'c@mail.utoronto.ca', name: 'C' },
    ];
    const body = await bodySent(announcementMail(members, '周五集会', '请准时到场。', 'https://utmmsc.com/UTMMSC/'));
    expect(body).not.toHaveProperty('to');
    expect(body).not.toHaveProperty('cc');
    expect(body).not.toHaveProperty('bcc');
    expect(body.messageVersions).toEqual(members.map((member) => ({ to: [member] })));
    expect(body.subject).toBe('UTMMSC 公告：周五集会');
  });

  it('keeps a single-recipient letter as one plain message', async () => {
    const body = await bodySent(verificationCodeMail('person@mail.utoronto.ca', '482913', 'register'));
    expect(body.to).toEqual([{ email: 'person@mail.utoronto.ca' }]);
    expect(body).not.toHaveProperty('messageVersions');
  });

  it('reports a rejected request', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 402 })));
    expect(await sendMail(config, announcementMail([{ email: 'a@mail.utoronto.ca', name: 'A' }], '标题', '正文', 'https://utmmsc.com/UTMMSC/'))).toBe(false);
  });

  it('only logs without an API key', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await sendMail({ ...config, apiKey: undefined }, verificationCodeMail('person@mail.utoronto.ca', '482913', 'register'))).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
