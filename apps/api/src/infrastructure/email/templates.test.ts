import { describe, expect, it } from 'vitest';
import { advisorInviteMail, announcementMail, verificationCodeMail } from './templates';

describe('letterhead mail', () => {
  it('puts the official mark at the head and the close, and keeps the code out of the subject', () => {
    const mail = verificationCodeMail('person@mail.utoronto.ca', '482913', 'register');
    expect(mail.subject).toBe('UTMMSC 注册验证码');
    expect(mail.subject).not.toContain('482913');
    expect(mail.html.match(/brand\/logo-horizontal\.png/g)?.length).toBe(2);
    expect(mail.html).toContain('482913');
    expect(mail.html).toContain('多伦多大学密西沙加校区国语学者联盟');
    expect(mail.html).toContain('Mandarin Scholars Coalition');
    expect(mail.text).toContain('utmmsc.com/UTMMSC');
    expect(mail.text).not.toContain('<img');
  });

  it('uses the same stationery for announcements', () => {
    const mail = announcementMail([{ email: 'a@utoronto.ca', name: 'A' }], '周五集会', '请准时到场。', 'https://utmmsc.com/UTMMSC/');
    expect(mail.html).toContain('brand/logo-horizontal.png');
    expect(mail.html).toContain('请准时到场。');
    expect(mail.subject).toBe('UTMMSC 公告：周五集会');
  });

  it('writes the advisor invitation in the language the sender chose', () => {
    const mail = advisorInviteMail('advisor@example.com', 'https://utmmsc.com/UTMMSC/register?invite=abc', 'en');
    expect(mail.subject).toBe('UTMMSC External honorary advisor invitation');
    expect(mail.html).toContain('MEMBER LETTER');
    expect(mail.html).toContain('external honorary advisor');
    expect(mail.text).toContain('Open only links on utmmsc.com');
    expect(mail.html).not.toContain('校外荣誉顾问邀请');
  });
});
