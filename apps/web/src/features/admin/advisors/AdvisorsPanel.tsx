import { useEffect, useState, type FormEvent } from 'react';
import { isUniversityEmail, normalizeEmail } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { Button } from '../../../shared/ui/Button';
import { Notice, Spinner } from '../../../shared/ui/Card';
import { Field, TextInput } from '../../../shared/ui/Field';
import { adminApi } from '../api';

interface InviteRow {
  id: string;
  email: string;
  expiresAt: string;
  createdAt: string;
}

/** System admin sends a one-purpose registration link to an off-campus advisor. */
/** 系统管理员给校外荣誉顾问发送只能用于该身份的注册链接。 */
export function AdvisorsPanel() {
  const [email, setEmail] = useState('');
  const [invites, setInvites] = useState<InviteRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    adminApi.advisorInvites().then((res) => setInvites(res.invites)).catch((err) => setError(errorMessage(err)));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const next = normalizeEmail(email);
    if (isUniversityEmail(next)) {
      setError('校友荣誉顾问请先用学校邮箱注册，再在成员身份里指定。');
      setSent(null);
      return;
    }
    setBusy(true);
    setError(null);
    setSent(null);
    try {
      const res = await adminApi.sendAdvisorInvite(next);
      setSent(`邀请已发到 ${res.email}`);
      setEmail('');
      const list = await adminApi.advisorInvites();
      setInvites(list.invites);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm leading-relaxed text-stone-500">
        校外荣誉顾问没有学校邮箱。填入对方邮箱后，系统会发一封邀请。对方只能用这个链接注册成校外荣誉顾问。链接 14 天内有效，再次发送会使上一封失效。校友荣誉顾问请对方自己用学校邮箱注册，再在「成员身份」里指定。
      </p>
      <form onSubmit={submit} className="space-y-3 rounded-xl bg-white p-3 ring-1 ring-stone-200">
        <Field label="被邀请人邮箱">
          <TextInput type="email" inputMode="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" />
        </Field>
        {error ? <Notice tone="error">{error}</Notice> : null}
        {sent ? <Notice>{sent}</Notice> : null}
        <Button type="submit" block loading={busy} disabled={!email.includes('@')}>
          发送邀请
        </Button>
      </form>
      {invites === null ? <Spinner /> : null}
      {invites && invites.length > 0 ? (
        <div className="space-y-2">
          <p className="text-sm text-stone-500">尚未注册的邀请</p>
          {invites.map((invite) => (
            <div key={invite.id} className="rounded-xl bg-white px-3 py-2 ring-1 ring-stone-200">
              <p className="truncate text-sm font-medium">{invite.email}</p>
              <p className="text-xs text-stone-500">有效期至 {invite.expiresAt.slice(0, 10)}</p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
