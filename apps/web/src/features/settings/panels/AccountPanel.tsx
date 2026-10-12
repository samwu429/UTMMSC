import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ENROLLMENT_LABELS, ROLE_LABELS, isStaffRole } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { useSessionStore } from '../../../shared/session/store';
import { BackHeader } from '../../../shared/ui/BackHeader';
import { Button } from '../../../shared/ui/Button';
import { Notice } from '../../../shared/ui/Card';
import { Field, TextInput } from '../../../shared/ui/Field';
import { MemberAvatar } from '../../profile/InitialAvatar';
import { ChevronIcon } from '../../profile/icons';
import { authApi } from '../../auth/api';

type Screen = 'list' | 'password' | 'install';

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function Group({ label, children, footer }: { label?: string; children: ReactNode; footer?: string }) {
  return (
    <section>
      {label ? <p className="px-4 pb-1.5 text-xs text-stone-500">{label}</p> : null}
      <div className="divide-y divide-stone-200 overflow-hidden rounded-xl bg-white ring-1 ring-stone-200">{children}</div>
      {footer ? <p className="px-4 pt-1.5 text-xs leading-relaxed text-stone-400">{footer}</p> : null}
    </section>
  );
}

function Row({ label, value, onClick }: { label: string; value?: string; onClick?: () => void }) {
  const className = 'flex min-h-12 w-full items-center gap-3 px-4 text-left text-[16px] active:bg-stone-50';
  const inner = (
    <>
      <span className="shrink-0 text-brand-800">{label}</span>
      {value ? <span className="min-w-0 flex-1 truncate text-right text-sm text-stone-400">{value}</span> : <span className="flex-1" />}
      {onClick ? <span className="shrink-0 text-stone-300"><ChevronIcon /></span> : null}
    </>
  );
  if (!onClick) return <div className={className}>{inner}</div>;
  return (
    <button type="button" onClick={onClick} className={className}>
      {inner}
    </button>
  );
}

function PasswordScreen({ onBack }: { onBack: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function changePassword(event: FormEvent) {
    event.preventDefault();
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

  return (
    <div>
      <BackHeader onBack={onBack} label="设置" title="修改密码" />
      <form onSubmit={changePassword} className="mt-2 space-y-3">
        <Field label="当前密码">
          <TextInput type="password" autoComplete="current-password" value={current} onChange={(event) => setCurrent(event.target.value)} />
        </Field>
        <Field label="新密码" hint="至少 8 位">
          <TextInput type="password" autoComplete="new-password" value={next} onChange={(event) => setNext(event.target.value)} />
        </Field>
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
        <Button type="submit" block loading={busy}>
          更新密码
        </Button>
      </form>
    </div>
  );
}

function InstallScreen({ onBack }: { onBack: () => void }) {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  return (
    <div>
      <BackHeader onBack={onBack} label="设置" title="添加到主屏幕" />
      <p className="mt-4 text-[15px] leading-relaxed text-stone-700">
        {ios ? '用 Safari 打开这个页面，点底部分享按钮，选「添加到主屏幕」。之后可以从主屏幕直接进来。' : '打开浏览器菜单，选「添加到主屏幕」或「安装应用」。之后可以从主屏幕直接进来。'}
      </p>
    </div>
  );
}

export function AccountPanel({ onOpenProfile, onPushed }: { onOpenProfile: () => void; onPushed: (pushed: boolean) => void }) {
  const member = useSessionStore((s) => s.member);
  const clear = useSessionStore((s) => s.clear);
  const [screen, setScreen] = useState<Screen>('list');
  const installed = isStandalone();

  useEffect(() => {
    onPushed(screen !== 'list');
  }, [screen, onPushed]);

  async function logout() {
    if (!window.confirm('退出登录？')) return;
    try {
      await authApi.logout();
    } finally {
      clear();
    }
  }

  if (screen === 'password') return <PasswordScreen onBack={() => setScreen('list')} />;
  if (screen === 'install') return <InstallScreen onBack={() => setScreen('list')} />;
  if (!member) return null;

  const year = `${member.graduationYear} 届 · ${ENROLLMENT_LABELS[member.enrollmentStatus]}${isStaffRole(member.role) ? ` · ${ROLE_LABELS[member.role]}` : ''}`;

  return (
    <div className="space-y-6">
      <Group>
        <button type="button" onClick={onOpenProfile} className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-stone-50">
          <MemberAvatar name={member.displayName} avatarKey={member.avatarKey} className="h-14 w-14 text-xl" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[18px] font-medium text-brand-800">{member.displayName}</span>
            <span className="mt-0.5 block truncate text-sm text-stone-500">{member.headline || '去完善资料'}</span>
          </span>
          <span className="shrink-0 text-stone-300"><ChevronIcon /></span>
        </button>
      </Group>

      <Group label="账号" footer="邮箱只有你自己能看到。">
        <Row label="邮箱" value={member.email} />
        <Row label="届别" value={year} />
        <Row label="修改密码" onClick={() => setScreen('password')} />
      </Group>

      {installed ? null : (
        <Group label="通用">
          <Row label="添加到主屏幕" onClick={() => setScreen('install')} />
        </Group>
      )}

      <Group>
        <button type="button" onClick={() => void logout()} className="min-h-12 w-full text-center text-[16px] font-medium text-red-600 active:bg-stone-50">
          退出登录
        </button>
      </Group>
    </div>
  );
}
