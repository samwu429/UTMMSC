import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { encodeProgramSelection, normalizeEmail, programChoiceState } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { useTr } from '../../../shared/i18n/locale';
import { Button } from '../../../shared/ui/Button';
import { Notice } from '../../../shared/ui/Card';
import { Field, TextArea, TextInput } from '../../../shared/ui/Field';
import { authApi } from '../api';
import { AuthLayout } from '../components/AuthLayout';
import { EMPTY_PROFILE, ProfileFields, type ProfileValues } from '../components/ProfileFields';

export function ApplyPage() {
  const tr = useTr();
  const [params] = useSearchParams();
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [profile, setProfile] = useState<ProfileValues>({ ...EMPTY_PROFILE, enrollmentStatus: 'alumni', graduationYear: String(new Date().getFullYear() - 1) });
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!profile.programs || !programChoiceState(profile.programs).ready) return;
    setError(null);
    setBusy(true);
    try {
      await authApi.apply({
        email: normalizeEmail(email),
        displayName: profile.displayName,
        enrollmentStatus: profile.enrollmentStatus,
        graduationYear: Number(profile.graduationYear),
        major: encodeProgramSelection(profile.programs) ?? undefined,
        note: note || undefined,
      });
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <AuthLayout title={tr('申请已提交', 'Application submitted')}>
        <Notice tone="success">
          {tr(
            `主席团审核后会发邮件到 ${email}。通过后按邮件里的链接设置密码即可登录。`,
            `The presidium will email ${email} after reviewing it. Once approved, follow the link in that email to set a password and sign in.`,
          )}
        </Notice>
        <Link to="/login" className="mt-4 block text-center text-sm text-brand-700">
          {tr('返回登录', 'Back to sign in')}
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={tr('人工申请', 'Manual application')} subtitle={tr('给无法使用学校邮箱的毕业生', 'For graduates who cannot use a university email')}>
      <form onSubmit={submit} className="space-y-4">
        <Field label={tr('常用邮箱', 'Email you use')}>
          <TextInput type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <ProfileFields value={profile} onChange={setProfile} />
        <Field label={tr('备注（选填）', 'Note (optional)')} hint={tr('例如曾任职务、可以证明身份的同学', 'For example, past club roles or classmates who can vouch for you')}>
          <TextArea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        </Field>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Button type="submit" block loading={busy} disabled={!programChoiceState(profile.programs).ready}>
          {tr('提交申请', 'Submit application')}
        </Button>
        <p className="text-center text-sm">
          <Link to="/register" className="text-brand-700">
            {tr('我有学校邮箱，去注册', 'I have a university email. Register instead')}
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}
