import { useState } from 'react';
import { errorMessage } from '../../../shared/api/errors';
import { useLabels } from '../../../shared/i18n/locale';
import { useSessionStore } from '../../../shared/session/store';
import { toast } from '../../../shared/ui/toast';
import { adminApi } from '../api';

/**
 * 正在以…测试: a system admin testing another role sees exactly that role's admin, and this strip says so with the way
 * back. AppShell draws it for the tabs; admin is outside AppShell, so it draws its own: under the title bar on phones
 * and at the top of the sidebar on desktop.
 * 「正在以…测试」：系统管理员测试其他身份时看到的正是那个身份的后台，这条提示说明这一点并提供返回的办法。AppShell 为各标签页显示它；
 * 管理后台在 AppShell 之外，所以自己显示：手机上在标题栏下方，桌面上在侧边栏顶部。
 */
export function TestingBanner({ variant }: { variant: 'bar' | 'card' }) {
  const member = useSessionStore((s) => s.member);
  const setMember = useSessionStore((s) => s.setMember);
  const { tr, role } = useLabels();
  const [busy, setBusy] = useState(false);
  if (!member || member.realRole !== 'superadmin' || !member.actingRole) return null;

  async function stop() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await adminApi.setActingRole(null);
      setMember(res.member);
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const text = tr(`正在以${role(member.actingRole)}测试`, `Testing as ${role(member.actingRole)}`);
  const button = (
    <button
      type="button"
      onClick={() => void stop()}
      disabled={busy}
      className="min-h-9 shrink-0 rounded-full bg-white px-3 text-[13px] font-medium text-brand-800 active:bg-brand-50 disabled:opacity-60"
    >
      {tr('回到系统管理员', 'Back to system administrator')}
    </button>
  );

  if (variant === 'card') {
    return (
      <div className="mx-3 mb-2 rounded-lg bg-brand-800 px-3 py-2.5 text-white">
        <p className="text-[13px] leading-snug">{text}</p>
        <div className="mt-2">{button}</div>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between gap-3 bg-brand-800 px-4 py-1.5 text-[13px] text-white">
      <span className="min-w-0 truncate">{text}</span>
      {button}
    </div>
  );
}
