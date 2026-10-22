import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ROLE_GROUPS, encodeProgramSelection, enrollmentYearLabel, enrollmentYearMax, enrollmentYearMin, isHonoraryRole, isStaffRole, isValidPassword, programChoiceState, readStoredProgramCodes, shouldGraduate, showsEnrollment, type Role } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { useLabels, useLocaleStore } from '../../../shared/i18n/locale';
import { useOffersAndroidApp } from '../../../shared/native/AndroidAppBanner';
import { isNativeApp } from '../../../shared/native/native';
import { ANDROID_APP_URL } from '../../../shared/native/platform';
import { useSessionStore } from '../../../shared/session/store';
import { BackHeader } from '../../../shared/ui/BackHeader';
import { Button } from '../../../shared/ui/Button';
import { Notice } from '../../../shared/ui/Card';
import { useConfirm } from '../../../shared/ui/confirm';
import { Field, Select, TextInput } from '../../../shared/ui/Field';
import { MemberAvatar } from '../../profile/InitialAvatar';
import { ChevronIcon } from '../../profile/icons';
import { authApi } from '../../auth/api';
import { adminApi } from '../../admin/api';
import { profileApi } from '../../profile/api';
import { ProgramPicker } from '../../auth/components/ProgramPicker';

type Screen = 'list' | 'password' | 'install' | 'programs' | 'year' | 'language';

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function Group({ label, children, footer }: { label?: string; children: ReactNode; footer?: string }) {
  return (
    <section className="-mx-4">
      {label ? <p className="px-4 pb-1.5 text-xs text-stone-500">{label}</p> : null}
      <div className="divide-y divide-stone-200 bg-white">{children}</div>
      {footer ? <p className="px-4 pt-1.5 text-xs leading-relaxed text-stone-400">{footer}</p> : null}
    </section>
  );
}

function Row({ label, value, onClick, href }: { label: string; value?: string; onClick?: () => void; href?: string }) {
  const className = 'flex min-h-12 w-full items-center gap-3 px-4 text-left text-[16px] active:bg-stone-50';
  const inner = (
    <>
      <span className="shrink-0 text-brand-800">{label}</span>
      {value ? <span className="min-w-0 flex-1 truncate text-right text-sm text-stone-400">{value}</span> : <span className="flex-1" />}
      {onClick || href ? <span className="shrink-0 text-stone-300"><ChevronIcon /></span> : null}
    </>
  );
  if (href) {
    return (
      <a href={href} className={className}>
        {inner}
      </a>
    );
  }
  if (!onClick) return <div className={className}>{inner}</div>;
  return (
    <button type="button" onClick={onClick} className={className}>
      {inner}
    </button>
  );
}

function LanguageScreen({ onBack }: { onBack: () => void }) {
  const { tr } = useLabels();
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);
  return (
    <div>
      <BackHeader onBack={onBack} label={tr('设置', 'Settings')} title={tr('语言', 'Language')} />
      <div className="mt-2 divide-y divide-stone-200 bg-white">
        {(
          [
            ['zh', '中文'],
            ['en', 'English'],
          ] as const
        ).map(([value, label]) => (
          <button key={value} type="button" onClick={() => setLocale(value)} className="flex min-h-12 w-full items-center px-4 text-left text-[16px] text-brand-800 active:bg-stone-50">
            <span className="flex-1">{label}</span>
            {locale === value ? <span aria-hidden>✓</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

function PasswordScreen({ onBack }: { onBack: () => void }) {
  const { tr } = useLabels();
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
      setMessage({ tone: 'success', text: tr('密码已更新', 'Password updated') });
    } catch (err) {
      setMessage({ tone: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <BackHeader onBack={onBack} label={tr('设置', 'Settings')} title={tr('修改密码', 'Change password')} />
      <form onSubmit={changePassword} className="mt-2 space-y-3">
        <Field label={tr('当前密码', 'Current password')}>
          <TextInput type="password" autoComplete="current-password" value={current} onChange={(event) => setCurrent(event.target.value)} />
        </Field>
        <Field label={tr('新密码', 'New password')} hint={tr('至少 8 位', 'At least 8 characters')}>
          <TextInput type="password" autoComplete="new-password" value={next} onChange={(event) => setNext(event.target.value)} />
        </Field>
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
        <Button type="submit" block loading={busy} disabled={!current || !isValidPassword(next)}>
          {tr('更新密码', 'Update password')}
        </Button>
      </form>
    </div>
  );
}

function YearScreen({ onBack }: { onBack: () => void }) {
  const { tr, year: yearLabel } = useLabels();
  const member = useSessionStore((s) => s.member);
  const [year, setYear] = useState(String(member?.graduationYear ?? ''));
  const [pendingYear, setPendingYear] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const years: number[] = [];
  for (let y = enrollmentYearMax(); y >= enrollmentYearMin(); y--) years.push(y);
  if (member && !years.includes(member.graduationYear)) {
    years.push(member.graduationYear);
    years.sort((a, b) => b - a);
  }

  useEffect(() => {
    profileApi.enrollmentYearRequest().then((res) => setPendingYear(res.request?.requestedYear ?? null)).catch(() => undefined);
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await profileApi.submitEnrollmentYear(Number(year));
      setPendingYear(res.request.requestedYear);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      await profileApi.cancelEnrollmentYear();
      setPendingYear(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <BackHeader onBack={onBack} label={tr('设置', 'Settings')} title={tr('入学年份', 'Enrollment year')} />
      <form onSubmit={submit} className="mt-2 space-y-3">
        <p className="text-sm leading-relaxed text-stone-500">
          {tr(
            `现在是 ${member ? enrollmentYearLabel(member.graduationYear) : ''}。提交后要等系统管理员同意，同意之前不会改。`,
            `Current year: ${member ? yearLabel(member.graduationYear) : ''}. A system administrator has to approve the change before it takes effect.`,
          )}
        </p>
        {pendingYear !== null ? <Notice>{tr(`已提交改为 ${pendingYear} 年，等待系统管理员同意。`, `Submitted a change to ${pendingYear}. Waiting for a system administrator.`)}</Notice> : null}
        <Field label={tr('申请改为', 'Request')}>
          <Select value={year} onChange={(event) => setYear(event.target.value)}>
            {years.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </Select>
        </Field>
        {member && member.enrollmentStatus === 'student' && shouldGraduate(Number(year), 'student') ? (
          <p className="text-sm leading-relaxed text-stone-500">{tr('这个年份已经满五年，同意后会记为毕业生。', 'This year is already five years ago. Approval will mark you as a graduate.')}</p>
        ) : null}
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Button type="submit" block loading={busy} disabled={Number(year) === member?.graduationYear}>
          {tr('提交申请', 'Submit request')}
        </Button>
        {pendingYear !== null ? (
          <Button type="button" variant="secondary" block disabled={busy} onClick={() => void cancel()}>
            {tr('撤回申请', 'Withdraw request')}
          </Button>
        ) : null}
      </form>
    </div>
  );
}

function ProgramsScreen({ onBack }: { onBack: () => void }) {
  const { tr } = useLabels();
  const member = useSessionStore((s) => s.member);
  const setMember = useSessionStore((s) => s.setMember);
  const stored = readStoredProgramCodes(member?.major);
  const [programs, setPrograms] = useState<string[] | null>(stored.kind === 'programs' ? stored.codes : stored.kind === 'empty' ? [] : null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const choice = programChoiceState(programs);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!choice.ready || programs === null) return;
    setBusy(true);
    setError(null);
    try {
      const res = await profileApi.update({ major: encodeProgramSelection(programs) });
      setMember(res.member);
      onBack();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <BackHeader onBack={onBack} label={tr('设置', 'Settings')} title={tr('专业', 'Program')} />
      <form onSubmit={save} className="mt-2 space-y-3">
        <p className="text-sm leading-relaxed text-stone-500">{tr('专业可以随时更改，不用找管理员。', 'You can change your program anytime. An administrator does not need to approve it.')}</p>
        <ProgramPicker programs={programs} onChange={setPrograms} legacyMajor={stored.kind === 'legacy' ? stored.text : null} />
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Button type="submit" block loading={busy} disabled={!choice.ready}>
          {tr('保存', 'Save')}
        </Button>
      </form>
    </div>
  );
}

function InstallScreen({ onBack }: { onBack: () => void }) {
  const { tr } = useLabels();
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  return (
    <div>
      <BackHeader onBack={onBack} label={tr('设置', 'Settings')} title={tr('添加到主屏幕', 'Add to Home Screen')} />
      <p className="mt-4 text-[15px] leading-relaxed text-stone-700">
        {ios
          ? tr('用 Safari 打开这个页面，点底部分享按钮，选「添加到主屏幕」。之后可以从主屏幕直接进来。', 'Open this page in Safari, tap the share button, and choose Add to Home Screen. You can then open it from the home screen.')
          : tr('打开浏览器菜单，选「添加到主屏幕」或「安装应用」。之后可以从主屏幕直接进来。', 'Open the browser menu and choose Add to Home Screen or Install app. You can then open it from the home screen.')}
      </p>
    </div>
  );
}

export function AccountPanel({ onOpenProfile, onPushed }: { onOpenProfile: () => void; onPushed: (pushed: boolean) => void }) {
  const member = useSessionStore((s) => s.member);
  const setMember = useSessionStore((s) => s.setMember);
  const clear = useSessionStore((s) => s.clear);
  const [screen, setScreen] = useState<Screen>('list');
  const [actingError, setActingError] = useState<string | null>(null);
  const [graduateError, setGraduateError] = useState<string | null>(null);
  const [pendingYear, setPendingYear] = useState<number | null>(null);
  const ask = useConfirm();
  const { tr, role, group, enrollment, year, major } = useLabels();
  const locale = useLocaleStore((s) => s.locale);
  const installed = isStandalone() || isNativeApp();
  const offersAndroidApp = useOffersAndroidApp();

  useEffect(() => {
    onPushed(screen !== 'list');
  }, [screen, onPushed]);

  useEffect(() => {
    if (screen !== 'list') return;
    profileApi.enrollmentYearRequest().then((res) => setPendingYear(res.request?.requestedYear ?? null)).catch(() => undefined);
  }, [screen]);

  async function switchActing(value: string) {
    setActingError(null);
    try {
      const res = await adminApi.setActingRole(value === 'superadmin' ? null : (value as Role));
      setMember(res.member);
    } catch (err) {
      setActingError(errorMessage(err));
    }
  }

  async function graduate() {
    const ok = await ask({
      title: tr('改为毕业生？', 'Mark yourself as a graduate?'),
      body: tr('之后不能自己改回在校生。入学年份仍然不能修改。', 'You will not be able to switch yourself back to student. The enrollment year still cannot be edited directly.'),
      confirmLabel: tr('确认毕业', 'Confirm'),
    });
    if (!ok) return;
    setGraduateError(null);
    try {
      const res = await profileApi.graduate();
      setMember(res.member);
    } catch (err) {
      setGraduateError(errorMessage(err));
    }
  }

  async function logout() {
    const ok = await ask({ title: tr('退出登录？', 'Sign out?'), confirmLabel: tr('退出', 'Sign out'), danger: true });
    if (!ok) return;
    try {
      await authApi.logout();
    } finally {
      clear();
    }
  }

  if (screen === 'password') return <PasswordScreen onBack={() => setScreen('list')} />;
  if (screen === 'programs') return <ProgramsScreen onBack={() => setScreen('list')} />;
  if (screen === 'year') return <YearScreen onBack={() => setScreen('list')} />;
  if (screen === 'install') return <InstallScreen onBack={() => setScreen('list')} />;
  if (screen === 'language') return <LanguageScreen onBack={() => setScreen('list')} />;
  if (!member) return null;

  const alumni = member.enrollmentStatus === 'alumni' || shouldGraduate(member.graduationYear, 'student');
  const title = isHonoraryRole(member.role) ? role(member.role) : null;
  const status = title ?? `${alumni ? enrollment('alumni') : enrollment('student')}${isStaffRole(member.role) ? ` · ${role(member.role)}` : ''}`;
  const campus = showsEnrollment(member.role);

  const real = member.realRole ?? member.role;

  return (
    <div className="space-y-2">
      {real === 'superadmin' ? (
        <Group label={tr('调试', 'Debug')}>
          <div className="px-4 py-3">
            <p className="text-sm leading-relaxed text-stone-500">{tr('系统管理员一直保留。换一个职位后，就按那个职位的权限使用。', 'You remain the system administrator. After you pick another role, the app uses that role’s permissions.')}</p>
            {actingError ? <div className="mt-2"><Notice tone="error">{actingError}</Notice></div> : null}
            <div className="mt-2">
              <Select value={member.actingRole ?? 'superadmin'} onChange={(event) => void switchActing(event.target.value)}>
                <option value="superadmin">{role('superadmin')}</option>
                {ROLE_GROUPS.filter((item) => item.label !== '系统').map((item) => (
                  <optgroup key={item.label} label={group(item.label)}>
                    {item.roles.map((itemRole) => (
                      <option key={itemRole} value={itemRole}>
                        {role(itemRole)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            </div>
          </div>
        </Group>
      ) : null}
      <Group>
        <button type="button" onClick={onOpenProfile} className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-stone-50">
          <MemberAvatar name={member.displayName} avatarKey={member.avatarKey} className="h-14 w-14 text-xl" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[18px] font-medium text-brand-800">{member.displayName}</span>
            <span className="mt-0.5 block truncate text-sm text-stone-500">{member.headline || tr('去完善资料', 'Complete your profile')}</span>
          </span>
          <span className="shrink-0 text-stone-300"><ChevronIcon /></span>
        </button>
      </Group>

      <Group label={tr('账号', 'Account')} footer={campus ? tr('入学年份要改的话，先提交申请，系统管理员同意后才生效。专业可以随时更改。邮箱只有你自己能看到。', 'To change your enrollment year, submit a request. It takes effect after a system administrator approves it. You can change your program anytime. Only you can see your email.') : tr('邮箱只有你自己能看到。', 'Only you can see your email.')}>
        <Row label={tr('邮箱', 'Email')} value={member.email} />
        {campus ? (
          <Row
            label={tr('入学年份', 'Enrollment year')}
            value={pendingYear !== null ? `${year(member.graduationYear)} · ${tr(`待同意 ${pendingYear}`, `pending ${pendingYear}`)}` : year(member.graduationYear)}
            onClick={() => setScreen('year')}
          />
        ) : null}
        <Row label={tr('状态', 'Status')} value={status} />
        {campus ? <Row label={tr('专业', 'Program')} value={major(member.major) ?? tr('尚未选择专业', 'No program selected')} onClick={() => setScreen('programs')} /> : null}
        {campus && !alumni && !member.actingRole ? (
          <button type="button" onClick={() => void graduate()} className="min-h-12 w-full px-4 text-left text-[16px] text-brand-800 active:bg-stone-50">
            {tr('我已毕业', 'I have graduated')}
          </button>
        ) : null}
        {graduateError ? <div className="px-4 py-2"><Notice tone="error">{graduateError}</Notice></div> : null}
        <Row label={tr('修改密码', 'Change password')} onClick={() => setScreen('password')} />
      </Group>

      <Group label={tr('通用', 'General')}>
        <Row label={tr('语言', 'Language')} value={locale === 'en' ? 'English' : '中文'} onClick={() => setScreen('language')} />
        {offersAndroidApp ? <Row label={tr('下载安卓 App', 'Get the Android app')} href={ANDROID_APP_URL} /> : null}
        {installed ? null : <Row label={tr('添加到主屏幕', 'Add to Home Screen')} onClick={() => setScreen('install')} />}
      </Group>

      <Group>
        <button type="button" onClick={() => void logout()} className="min-h-12 w-full text-center text-[16px] font-medium text-red-600 active:bg-stone-50">
          {tr('退出登录', 'Sign out')}
        </button>
      </Group>
    </div>
  );
}
