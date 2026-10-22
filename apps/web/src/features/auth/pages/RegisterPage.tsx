import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { encodeProgramSelection, enrollmentForEmail, isUniversityEmail, normalizeEmail, programChoiceState } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { useTr } from '../../../shared/i18n/locale';
import { useSessionStore } from '../../../shared/session/store';
import { Button } from '../../../shared/ui/Button';
import { Notice, Spinner } from '../../../shared/ui/Card';
import { Field, TextInput } from '../../../shared/ui/Field';
import { authApi } from '../api';
import { AuthLayout } from '../components/AuthLayout';
import { CodeField } from '../components/CodeField';
import { EMPTY_PROFILE, ProfileFields, type ProfileValues } from '../components/ProfileFields';

/**
 * Every registration proves the inbox with a code. Approved manual applicants arrive via the
 * emailed link with `approved=1`. An advisor invite can only create an external advisor.
 * 每次注册都用验证码证明邮箱归属。人工审核通过者通过邮件链接（`approved=1`）进入。荣誉顾问邀请只能注册成校外荣誉顾问。
 */
export function RegisterPage() {
  const [params] = useSearchParams();
  const setSession = useSessionStore((s) => s.setSession);
  const inviteToken = params.get('invite') ?? '';
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [profile, setProfile] = useState<ProfileValues>(EMPTY_PROFILE);
  const [inviteReady, setInviteReady] = useState(!inviteToken);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tr = useTr();

  const approvedFlow = !inviteToken && params.get('approved') === '1';
  const university = isUniversityEmail(email);
  // An approved manual application already fixed the status, and the server uses the reviewed one.
  // 人工审核通过的申请已经确定了状态，服务端以审核时的为准。
  const fixedStatus = approvedFlow ? null : enrollmentForEmail(email);
  const needsCode = inviteToken ? inviteReady : approvedFlow || university;
  const showManualHint = !inviteToken && email.includes('@') && !university && !approvedFlow;
  const programsReady = programChoiceState(profile.programs).ready;

  useEffect(() => {
    if (!inviteToken) return;
    let cancelled = false;
    authApi
      .invite(inviteToken)
      .then((res) => {
        if (cancelled) return;
        setEmail(res.email);
        setInviteReady(true);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [inviteToken]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!inviteToken && (!profile.programs || !programChoiceState(profile.programs).ready)) return;
    setError(null);
    setBusy(true);
    try {
      const session = inviteToken
        ? await authApi.register({
            email: normalizeEmail(email),
            code,
            password,
            displayName: displayName.trim(),
            invite: inviteToken,
          })
        : await authApi.register({
            email: normalizeEmail(email),
            code,
            password,
            displayName: profile.displayName,
            enrollmentStatus: profile.enrollmentStatus,
            graduationYear: Number(profile.graduationYear),
            major: encodeProgramSelection(profile.programs ?? []) ?? undefined,
          });
      setSession(session.token, session.member, session.mediaToken);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const subtitle = inviteToken
    ? tr('注册为校外荣誉顾问', 'Register as an external honorary advisor')
    : approvedFlow
      ? tr('申请已通过，请设置密码', 'Your application was approved. Set a password.')
      : tr('使用多伦多大学邮箱', 'Use a University of Toronto email');

  return (
    <AuthLayout title={tr('注册', 'Register')} subtitle={subtitle}>
      {inviteToken && !inviteReady && !error ? <Spinner /> : null}
      {inviteToken && error && !inviteReady ? <Notice tone="error">{error}</Notice> : null}
      {!inviteToken || inviteReady ? (
        <form onSubmit={submit} className="space-y-4">
          <Field label={tr('邮箱', 'Email')} hint={inviteToken || approvedFlow ? undefined : tr('支持 mail.utoronto.ca、utoronto.ca、alumni.utoronto.ca', 'mail.utoronto.ca, utoronto.ca, or alumni.utoronto.ca')}>
            <TextInput type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} readOnly={approvedFlow || Boolean(inviteToken)} />
          </Field>
          {showManualHint ? (
            <Notice>
              {tr('这不是学校邮箱。已毕业且无法使用学校邮箱的同学，请', 'This is not a university email. Graduates who cannot use one should')}{' '}
              <Link to={`/apply?email=${encodeURIComponent(email)}`} className="underline">
                {tr('提交人工申请', 'submit a manual application')}
              </Link>
              {tr('。', '.')}
            </Notice>
          ) : null}
          {needsCode ? <CodeField email={normalizeEmail(email)} purpose="register" value={code} onChange={setCode} onError={setError} /> : null}
          <Field label={tr('设置密码', 'Password')} hint={tr('至少 8 位', 'At least 8 characters')}>
            <TextInput type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {inviteToken ? (
            <Field label={tr('姓名', 'Name')}>
              <TextInput autoComplete="name" value={displayName} maxLength={40} onChange={(e) => setDisplayName(e.target.value)} />
            </Field>
          ) : (
            <ProfileFields value={profile} onChange={setProfile} fixedStatus={fixedStatus} />
          )}
          {error ? <Notice tone="error">{error}</Notice> : null}
          <Button type="submit" block loading={busy} disabled={inviteToken ? displayName.trim().length < 2 : showManualHint || !programsReady}>
            {tr('完成注册', 'Create account')}
          </Button>
          <p className="text-center text-sm">
            {tr('已有账号？', 'Already have an account?')}{' '}
            <Link to="/login" className="text-brand-700">
              {tr('去登录', 'Sign in')}
            </Link>
          </p>
        </form>
      ) : null}
    </AuthLayout>
  );
}
