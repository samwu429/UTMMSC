import { useState, type FormEvent } from 'react';
import { errorMessage } from '../../../shared/api/errors';
import { useTr } from '../../../shared/i18n/locale';
import { Button } from '../../../shared/ui/Button';
import { Card, Notice } from '../../../shared/ui/Card';
import { useConfirm } from '../../../shared/ui/confirm';
import { Field, TextArea, TextInput } from '../../../shared/ui/Field';
import { adminApi } from '../api';

/** The only place that emails every member; a confirmation guards the free-tier daily quota. */
/** 唯一会给全体成员发邮件的入口；确认步骤用于保护免费档的每日额度。 */
export function AnnouncementsPanel() {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [sendEmail, setSendEmail] = useState(true);
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const ask = useConfirm();
  const tr = useTr();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (sendEmail) {
      const ok = await ask({
        title: tr('给全体成员发邮件？', 'Email every member?'),
        body: tr('发出后会送到每位成员的邮箱。', 'Once sent, it goes to every member by email.'),
        confirmLabel: tr('发送', 'Send'),
      });
      if (!ok) return;
    }
    setMessage(null);
    setBusy(true);
    try {
      const res = await adminApi.announce({ title, body, sendEmail });
      setMessage({
        tone: 'success',
        text: res.emailed
          ? tr(`已向 ${res.recipientCount} 位成员发送邮件`, `Emailed ${res.recipientCount} ${res.recipientCount === 1 ? 'member' : 'members'}.`)
          : tr(`公告已记录（${res.recipientCount} 位成员，未发邮件）`, `Announcement saved for ${res.recipientCount} ${res.recipientCount === 1 ? 'member' : 'members'}. No email was sent.`),
      });
      setTitle('');
      setBody('');
    } catch (err) {
      setMessage({ tone: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="mb-3 font-semibold">{tr('全员公告', 'Announcement to all members')}</h2>
      <form onSubmit={submit} className="space-y-3">
        <Field label={tr('标题', 'Title')}>
          <TextInput value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
        </Field>
        <Field label={tr('正文', 'Message')}>
          <TextArea value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} className="min-h-[160px]" />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} className="h-4 w-4" />
          {tr('同时发送邮件给全体成员', 'Also email every member')}
        </label>
        <Notice>
          {tr(
            '建议先在「公告」频道发消息；邮件留给确实需要所有人看到的内容。',
            'Post in the Announcements channel first. Save email for things everyone really needs to see.',
          )}
        </Notice>
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
        <Button type="submit" block loading={busy} disabled={!title.trim() || !body.trim()}>
          {tr('发布', 'Publish')}
        </Button>
      </form>
    </Card>
  );
}
