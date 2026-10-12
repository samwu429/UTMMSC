import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { isUniversityEmail, normalizeEmail } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { useSessionStore } from '../../../shared/session/store';
import { Button } from '../../../shared/ui/Button';
import { Notice } from '../../../shared/ui/Card';
import { Field, TextInput } from '../../../shared/ui/Field';
import { authApi } from '../api';
import { AuthLayout } from '../components/AuthLayout';
import { CodeField } from '../components/CodeField';
import { EMPTY_PROFILE, ProfileFields, type ProfileValues } from '../components/ProfileFields';

/**
 * University addresses verify with a code. Approved manual applicants arrive via the emailed link
 * with `approved=1` and skip the code step.
 * 学校邮箱用验证码验证。人工审核通过者通过邮件链接（`approved=1`）进入，跳过验证码。
 */
export function RegisterPage() {
  const [params] = useSearchParams();
  const setSession = useSessionStore((s) => s.setSession);
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [profile, setProfile] = useState<ProfileValues>(EMPTY_PROFILE);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const approvedFlow = params.get('approved') === '1';
  const university = isUniversityEmail(email);
  const needsCode = !approvedFlow && university;
  const showManualHint = email.includes('@') && !university && !approvedFlow;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const session = await authApi.register({
        email: normalizeEmail(email),
        code,
        password,
        displayName: profile.displayName,
        enrollmentStatus: profile.enrollmentStatus,
        graduationYear: Number(profile.graduationYear),
        major: profile.major || undefined,
      });
      setSession(session.token, session.member, session.mediaToken);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="注册" subtitle={approvedFlow ? '申请已通过，请设置密码' : '使用多伦多大学邮箱'}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="邮箱" hint={approvedFlow ? undefined : '支持 mail.utoronto.ca、utoronto.ca、alumni.utoronto.ca'}>
          <TextInput type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} readOnly={approvedFlow} />
        </Field>
        {showManualHint ? (
          <Notice>
            这不是学校邮箱。已毕业且无法使用学校邮箱的同学，请{' '}
            <Link to={`/apply?email=${encodeURIComponent(email)}`} className="underline">
              提交人工申请
            </Link>
            。
          </Notice>
        ) : null}
        {needsCode ? <CodeField email={normalizeEmail(email)} purpose="register" value={code} onChange={setCode} onError={setError} /> : null}
        <Field label="设置密码" hint="至少 8 位">
          <TextInput type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <ProfileFields value={profile} onChange={setProfile} />
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Button type="submit" block loading={busy} disabled={showManualHint}>
          完成注册
        </Button>
        <p className="text-center text-sm">
          已有账号？{' '}
          <Link to="/login" className="text-brand-700">
            去登录
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}
