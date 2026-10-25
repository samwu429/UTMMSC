import { useId, useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { isUniversityEmail, isWellFormedEmail, normalizeEmail } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { formatRelative } from '../../../shared/format/time';
import { useLocaleStore, useTr } from '../../../shared/i18n/locale';
import { Button } from '../../../shared/ui/Button';
import { toast } from '../../../shared/ui/toast';
import { adminApi, type AdminAdvisorInvite } from '../api';
import { AdminScreen, useSectionBack } from '../layout/AdminScreen';
import { useInsetGroups } from '../layout/media';
import { sectionPath } from '../sections';
import { useAdminQuery } from '../state/adminCache';
import { refreshAdminSummary } from '../state/summaryStore';
import { AdminCell, AdminGroup } from '../ui/AdminCell';
import { SegmentedControl } from '../ui/Choices';
import { LoadFailed } from '../ui/Feedback';
import { formatDay } from '../ui/labels';
import { ListSkeleton } from '../ui/ListSkeleton';
import { useAdminConfirm } from '../ui/overlayGate';

type MailLanguage = 'zh' | 'en';

const loadInvites = async () => (await adminApi.advisorInvites()).invites;

/**
 * 荣誉顾问邀请, for the system admin: an off-campus advisor has no university email, so they register through a
 * one-purpose link sent here. Open invitations are listed with 重新发送, which sends a fresh link to the same address
 * after saying that the old one stops working.
 * 「荣誉顾问邀请」，供系统管理员使用：校外荣誉顾问没有学校邮箱，因此通过这里发送的专用链接注册。未使用的邀请列在下方，并带有「重新发送」，
 * 说明旧链接会失效之后向同一地址发送新的链接。
 */
export function AdvisorsSection() {
  const tr = useTr();
  const siteLocale = useLocaleStore((s) => s.locale);
  const back = useSectionBack();
  const insetGroups = useInsetGroups();
  const confirm = useAdminConfirm();
  const { pathname } = useLocation();
  const emailId = useId();
  const invites = useAdminQuery<AdminAdvisorInvite[]>('invites', loadInvites);
  const [email, setEmail] = useState('');
  const [lang, setLang] = useState<MailLanguage>(siteLocale);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const base = sectionPath('advisors');
  if (pathname !== base && pathname !== `${base}/`) return <Navigate to={base} replace />;

  const languageName = (value: MailLanguage) => (value === 'zh' ? '中文' : 'English');

  async function send(address: string, again: boolean): Promise<boolean> {
    setBusy(address);
    setProblem(null);
    try {
      const res = await adminApi.sendAdvisorInvite(address, lang);
      toast(again ? tr(`已重新发送到 ${res.email}`, `Sent again to ${res.email}`) : tr(`邀请已发到 ${res.email}`, `Invitation sent to ${res.email}`));
      void invites.refresh();
      refreshAdminSummary();
      return true;
    } catch (err) {
      if (again) toast(errorMessage(err));
      else setProblem(errorMessage(err));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const address = normalizeEmail(email);
    if (!isWellFormedEmail(address)) {
      setProblem(tr('邮箱格式错误', 'That email address is not valid.'));
      return;
    }
    if (isUniversityEmail(address)) {
      setProblem(tr('校友荣誉顾问请先用学校邮箱注册，再在「成员与身份」里指定。', 'Alumni honorary advisors register with a university email first. Then assign the role under Members and roles.'));
      return;
    }
    if (await send(address, false)) setEmail('');
  }

  async function resend(invite: AdminAdvisorInvite) {
    if (busy) return;
    const ok = await confirm({
      title: tr(`重新发送给 ${invite.email}？`, `Send again to ${invite.email}?`),
      body: tr(`重新发送会使上一封失效。邮件语言：${languageName(lang)}。`, `Sending again cancels the previous invitation. Email language: ${languageName(lang)}.`),
      confirmLabel: tr('重新发送', 'Send again'),
    });
    if (ok) await send(invite.email, true);
  }

  const note = insetGroups ? 'px-1' : 'px-4';
  return (
    <AdminScreen title={tr('荣誉顾问邀请', 'Advisor invitations')} back={back} top>
      <p className={`pb-1 pt-3 text-[13px] leading-relaxed text-wx-meta ${note}`}>
        {tr(
          '校外荣誉顾问没有学校邮箱。填入对方邮箱后，系统会发一封邀请，对方只能用这个链接注册成校外荣誉顾问。链接 14 天内有效。校友荣誉顾问请对方自己用学校邮箱注册，再在「成员与身份」里指定。',
          'External honorary advisors do not have a university email. Enter their address and the system sends an invitation; that link can only register an external honorary advisor. It is valid for 14 days. Alumni honorary advisors register themselves with a university email, then you assign the role under Members and roles.',
        )}
      </p>
      <form onSubmit={(event) => void submit(event)}>
        <AdminGroup title={tr('发送邀请', 'Send an invitation')}>
          <div className="space-y-3 px-4 py-3.5">
            <label htmlFor={emailId} className="block text-[13px] font-medium text-stone-600">
              {tr('被邀请人邮箱', 'Invitee email')}
            </label>
            <input
              id={emailId}
              type="email"
              inputMode="email"
              autoComplete="email"
              enterKeyHint="send"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setProblem(null);
              }}
              placeholder="name@example.com"
              className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-[16px] text-stone-900 outline-none focus:border-brand-800 focus:ring-2 focus:ring-brand-100"
            />
            <div>
              <p className="mb-1.5 text-[13px] font-medium text-stone-600">{tr('邮件语言', 'Email language')}</p>
              <SegmentedControl<MailLanguage>
                label={tr('邮件语言', 'Email language')}
                value={lang}
                onChange={setLang}
                options={[
                  { value: 'zh', label: '中文' },
                  { value: 'en', label: 'English' },
                ]}
              />
            </div>
            {problem ? (
              <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-[14px] text-red-800">
                {problem}
              </p>
            ) : null}
            <Button type="submit" block loading={busy !== null && busy === normalizeEmail(email)} disabled={!email.includes('@') || busy !== null}>
              {tr('发送邀请', 'Send invitation')}
            </Button>
          </div>
        </AdminGroup>
      </form>

      {!invites.data ? (
        invites.error ? (
          <LoadFailed error={invites.error} onRetry={() => void invites.refresh()} />
        ) : (
          <div className="mt-5">
            <ListSkeleton rows={2} />
          </div>
        )
      ) : (
        <>
          {invites.error ? <LoadFailed error={invites.error} onRetry={() => void invites.refresh()} /> : null}
          <AdminGroup
            title={tr(`尚未注册的邀请 ${invites.data.length}`, `Invitations not yet used: ${invites.data.length}`)}
            footer={invites.data.length === 0 ? tr('发出的邀请在对方注册之前会列在这里。', 'Invitations show here until the person registers.') : undefined}
          >
            {invites.data.map((invite) => (
              <AdminCell
                key={invite.id}
                label={invite.email}
                detail={tr(
                  `${formatRelative(invite.createdAt)}发送 · 有效期至 ${formatDay(invite.expiresAt, 'zh')}`,
                  `Sent ${formatRelative(invite.createdAt)} · valid until ${formatDay(invite.expiresAt, 'en')}`,
                )}
                trailing={
                  <button
                    type="button"
                    onClick={() => void resend(invite)}
                    disabled={busy !== null}
                    className="min-h-11 shrink-0 rounded-lg px-2 text-[15px] font-medium text-brand-800 active:bg-stone-100 disabled:text-stone-400"
                  >
                    {busy === invite.email ? tr('发送中…', 'Sending…') : tr('重新发送', 'Send again')}
                  </button>
                }
              />
            ))}
          </AdminGroup>
        </>
      )}
    </AdminScreen>
  );
}
