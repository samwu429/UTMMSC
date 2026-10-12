import { useState, type FormEvent } from 'react';
import { errorMessage } from '../../../shared/api/errors';
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

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (sendEmail) {
      const ok = await ask({ title: '给全体成员发邮件？', body: '发出后会送到每位成员的邮箱。', confirmLabel: '发送' });
      if (!ok) return;
    }
    setMessage(null);
    setBusy(true);
    try {
      const res = await adminApi.announce({ title, body, sendEmail });
      setMessage({ tone: 'success', text: res.emailed ? `已向 ${res.recipientCount} 位成员发送邮件` : `公告已记录（${res.recipientCount} 位成员，未发邮件）` });
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
      <h2 className="mb-3 font-semibold">全员公告</h2>
      <form onSubmit={submit} className="space-y-3">
        <Field label="标题">
          <TextInput value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
        </Field>
        <Field label="正文">
          <TextArea value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} className="min-h-[160px]" />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} className="h-4 w-4" />
          同时发送邮件给全体成员
        </label>
        <Notice>建议先在「公告」频道发消息；邮件留给确实需要所有人看到的内容。</Notice>
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
        <Button type="submit" block loading={busy} disabled={!title.trim() || !body.trim()}>
          发布
        </Button>
      </form>
    </Card>
  );
}
