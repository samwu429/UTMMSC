import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { encodeProgramSelection, isUniversityEmail, normalizeEmail, programChoiceState } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { useSessionStore } from '../../../shared/session/store';
import { Button } from '../../../shared/ui/Button';
import { Notice, Spinner } from '../../../shared/ui/Card';
import { Field, TextInput } from '../../../shared/ui/Field';
import { authApi } from '../api';
import { AuthLayout } from '../components/AuthLayout';
import { CodeField } from '../components/CodeField';
import { EMPTY_PROFILE, ProfileFields, type ProfileValues } from '../components/ProfileFields';

/**
 * University addresses verify with a code. Approved manual applicants arrive via the emailed link
 * with `approved=1` and skip the code step. An advisor invite can only create an external advisor.
 * 学校邮箱用验证码验证。人工审核通过者通过邮件链接（`approved=1`）进入，跳过验证码。荣誉顾问邀请只能注册成校外荣誉顾问。
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

  const approvedFlow = !inviteToken && params.get('approved') === '1';
  const university = isUniversityEmail(email);
  const needsCode = inviteToken ? inviteReady : !approvedFlow && university;
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

  const subtitle = inviteToken ? '注册为校外荣誉顾问' : approvedFlow ? '申请已通过，请设置密码' : '使用多伦多大学邮箱';

  return (
    <AuthLayout title="注册" subtitle={subtitle}>
      {inviteToken && !inviteReady && !error ? <Spinner /> : null}
      {inviteToken && error && !inviteReady ? <Notice tone="error">{error}</Notice> : null}
      {!inviteToken || inviteReady ? (
        <form onSubmit={submit} className="space-y-4">
          <Field label="邮箱" hint={inviteToken || approvedFlow ? undefined : '支持 mail.utoronto.ca、utoronto.ca、alumni.utoronto.ca'}>
            <TextInput type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} readOnly={approvedFlow || Boolean(inviteToken)} />
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
          {inviteToken ? (
            <Field label="姓名">
              <TextInput value={displayName} maxLength={40} onChange={(e) => setDisplayName(e.target.value)} />
            </Field>
          ) : (
            <ProfileFields value={profile} onChange={setProfile} />
          )}
          {error ? <Notice tone="error">{error}</Notice> : null}
          <Button type="submit" block loading={busy} disabled={inviteToken ? displayName.trim().length < 2 : showManualHint || !programsReady}>
            完成注册
          </Button>
          <p className="text-center text-sm">
            已有账号？{' '}
            <Link to="/login" className="text-brand-700">
              去登录
            </Link>
          </p>
        </form>
      ) : null}
    </AuthLayout>
  );
}
