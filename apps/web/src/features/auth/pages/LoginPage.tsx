import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage } from '../../../shared/api/errors';
import { useTr } from '../../../shared/i18n/locale';
import { useSessionStore } from '../../../shared/session/store';
import { Button } from '../../../shared/ui/Button';
import { Notice } from '../../../shared/ui/Card';
import { Field, TextInput } from '../../../shared/ui/Field';
import { authApi } from '../api';
import { AuthLayout } from '../components/AuthLayout';

export function LoginPage() {
  const setSession = useSessionStore((s) => s.setSession);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tr = useTr();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const session = await authApi.login({ email, password });
      setSession(session.token, session.member, session.mediaToken);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title={tr('登录', 'Sign in')} subtitle={tr('成员网络', 'Member network')} centered>
      <form onSubmit={submit} className="space-y-4">
        <Field label={tr('邮箱', 'Email')}>
          <TextInput type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label={tr('密码', 'Password')}>
          <TextInput type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Button type="submit" block loading={busy}>
          {tr('登录', 'Sign in')}
        </Button>
        <div className="flex justify-center gap-8 text-sm">
          <Link to="/forgot" className="inline-flex min-h-11 items-center px-2 text-sm text-brand-800">
            {tr('忘记密码', 'Forgot password')}
          </Link>
          <Link to="/register" className="inline-flex min-h-11 items-center px-2 text-sm text-brand-800">
            {tr('注册', 'Register')}
          </Link>
        </div>
      </form>
    </AuthLayout>
  );
}
