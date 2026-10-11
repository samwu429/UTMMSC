import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { normalizeEmail } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { useSessionStore } from '../../../shared/session/store';
import { Button } from '../../../shared/ui/Button';
import { Notice } from '../../../shared/ui/Card';
import { Field, TextInput } from '../../../shared/ui/Field';
import { authApi } from '../api';
import { AuthLayout } from '../components/AuthLayout';
import { CodeField } from '../components/CodeField';

export function ForgotPage() {
  const setSession = useSessionStore((s) => s.setSession);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const session = await authApi.reset({ email: normalizeEmail(email), code, password });
      setSession(session.token, session.member);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="重置密码" subtitle="验证码会发到注册邮箱">
      <form onSubmit={submit} className="space-y-4">
        <Field label="邮箱">
          <TextInput type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <CodeField email={normalizeEmail(email)} purpose="reset" value={code} onChange={setCode} onError={setError} />
        <Field label="新密码" hint="至少 8 位">
          <TextInput type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Button type="submit" block loading={busy}>
          重置并登录
        </Button>
        <p className="text-center text-sm">
          <Link to="/login" className="text-brand-700">
            返回登录
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}
