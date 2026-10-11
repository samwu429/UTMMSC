import { useState, type FormEvent } from 'react';
import { ENROLLMENT_LABELS, ROLE_LABELS } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { useSessionStore } from '../../../shared/session/store';
import { Button } from '../../../shared/ui/Button';
import { Card, Notice, PageTitle } from '../../../shared/ui/Card';
import { Field, TextInput } from '../../../shared/ui/Field';
import { authApi } from '../../auth/api';

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function SettingsPage() {
  const member = useSessionStore((s) => s.member);
  const clear = useSessionStore((s) => s.clear);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    setBusy(true);
    try {
      await authApi.changePassword({ currentPassword: current, newPassword: next });
      setCurrent('');
      setNext('');
      setMessage({ tone: 'success', text: '密码已更新' });
    } catch (err) {
      setMessage({ tone: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    try {
      await authApi.logout();
    } finally {
      clear();
    }
  }

  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);

  return (
    <div className="space-y-4">
      <PageTitle>我的</PageTitle>
      {member ? (
        <Card>
          <p className="text-lg font-semibold">{member.displayName}</p>
          <p className="text-sm text-slate-500">{member.email}</p>
          <p className="mt-1 text-sm text-slate-500">
            {member.graduationYear} 届 · {ENROLLMENT_LABELS[member.enrollmentStatus]} · {ROLE_LABELS[member.role]}
          </p>
        </Card>
      ) : null}

      {!isStandalone() ? (
        <Notice>
          {ios ? '在 Safari 里点击底部分享按钮，选择「添加到主屏幕」，即可像应用一样打开。' : '在浏览器菜单里选择「添加到主屏幕」或「安装应用」，即可像应用一样打开。'}
        </Notice>
      ) : null}

      <Card>
        <h2 className="mb-3 font-semibold">修改密码</h2>
        <form onSubmit={changePassword} className="space-y-3">
          <Field label="当前密码">
            <TextInput type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </Field>
          <Field label="新密码" hint="至少 8 位">
            <TextInput type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          </Field>
          {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
          <Button type="submit" variant="secondary" block loading={busy}>
            更新密码
          </Button>
        </form>
      </Card>

      <Button variant="danger" block onClick={logout}>
        退出登录
      </Button>
    </div>
  );
}
