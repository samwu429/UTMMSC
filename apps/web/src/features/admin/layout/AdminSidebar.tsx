import { Link, useLocation } from 'react-router-dom';
import { ADMIN_SECTION_GROUPS, ADMIN_SECTION_GROUP_LABELS, ADMIN_SECTIONS, adminBadgeCount, canUseAdminSection, type AdminSectionKey } from '@utmmsc/shared';
import { useLabels } from '../../../shared/i18n/locale';
import { useSessionStore } from '../../../shared/session/store';
import { UnreadDot } from '../../chat/components/UnreadDot';
import { ADMIN_HOME, adminLanding, sectionOfPath } from '../sections';
import { useAdminCounts } from '../state/summaryStore';
import { AdminIcon, type AdminIconName } from '../ui/icons';
import { TestingBanner } from './TestingBanner';

function SidebarLink({ to, icon, label, active, count }: { to: string; icon: AdminIconName; label: string; active: boolean; count: number }) {
  const { tr } = useLabels();
  return (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      className={`relative flex min-h-11 items-center gap-3 rounded-lg px-3 text-[15px] outline-offset-0 ${
        active ? 'bg-brand-50 font-medium text-brand-800' : 'text-stone-700 hover:bg-stone-50 active:bg-stone-100'
      }`}
    >
      {active ? <span aria-hidden className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-gold" /> : null}
      <AdminIcon name={icon} className={`h-5 w-5 shrink-0 ${active ? 'text-brand-800' : 'text-stone-500'}`} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count > 0 ? (
        <>
          <UnreadDot count={count} />
          <span className="sr-only">{tr(`，${count} 项待处理`, `, ${count} waiting`)}</span>
        </>
      ) : null}
    </Link>
  );
}

/**
 * The desktop sidebar (1024px and wider): the way back to the app, the overview, then the sections the viewed role
 * may use, grouped 成员 / 内容 / 安全, with the red counts of waiting work. The current section stays highlighted
 * while one of its items is open.
 * 桌面侧边栏（1024px 及以上）：返回应用的入口、管理首页，然后是当前视角的身份可用的板块，按「成员 / 内容 / 安全」分组，并带有待处理事项的
 * 红色数字。打开板块中的某个项目时，该板块仍保持高亮。
 */
export function AdminSidebar() {
  const { tr, role: roleLabel } = useLabels();
  const member = useSessionStore((s) => s.member);
  const counts = useAdminCounts();
  const { pathname } = useLocation();
  if (!member) return null;
  const current: AdminSectionKey | null = sectionOfPath(pathname);
  const onHome = pathname === ADMIN_HOME || pathname === `${ADMIN_HOME}/`;

  return (
    <aside
      className="sticky top-0 flex h-[100dvh] flex-col overflow-y-auto overscroll-contain border-r-[0.5px] border-wx-line bg-white"
      style={{ paddingTop: 'var(--safe-top)', paddingBottom: 'var(--safe-bottom)' }}
    >
      <div className="px-2 pt-2">
        <Link to="/discover" className="inline-flex min-h-11 items-center gap-0.5 rounded-lg pl-1 pr-3 text-[15px] font-medium text-brand-800 hover:bg-stone-50 active:bg-stone-100">
          <AdminIcon name="back" className="h-5 w-5" strokeWidth={2} />
          {tr('返回应用', 'Back to app')}
        </Link>
      </div>
      <p className="px-5 pb-3 pt-1 text-[22px] font-semibold tracking-tight text-brand-800">{tr('管理', 'Admin')}</p>
      <TestingBanner variant="card" />
      <nav aria-label={tr('管理', 'Admin')} className="flex-1 px-2 pb-4">
        {/* A role with one section lands straight in it, so it has no overview to link to. */}
        {/* 只有一个板块的身份会直接进入该板块，因此没有管理首页可链接。 */}
        {adminLanding(member.role) === null ? (
          <>
            <p className="px-3 pb-1 pt-2 text-[12px] font-medium text-wx-meta">{tr('概览', 'Overview')}</p>
            <SidebarLink to={ADMIN_HOME} icon="overview" label={tr('管理首页', 'Overview')} active={onHome} count={0} />
          </>
        ) : null}
        {ADMIN_SECTION_GROUPS.map((group) => {
          const sections = ADMIN_SECTIONS.filter((section) => section.group === group && canUseAdminSection(member.role, section.key));
          if (sections.length === 0) return null;
          const label = ADMIN_SECTION_GROUP_LABELS[group];
          return (
            <div key={group} className="mt-3">
              <p className="px-3 pb-1 text-[12px] font-medium text-wx-meta">{tr(label.zh, label.en)}</p>
              {sections.map((section) => (
                <SidebarLink
                  key={section.key}
                  to={section.path}
                  icon={section.key}
                  label={tr(section.zh, section.en)}
                  active={current === section.key}
                  count={counts ? adminBadgeCount(section.key, counts) : 0}
                />
              ))}
            </div>
          );
        })}
      </nav>
      <p className="px-5 pb-4 text-[12px] leading-relaxed text-wx-meta">{tr(`当前身份：${roleLabel(member.role)}`, `Your role: ${roleLabel(member.role)}`)}</p>
    </aside>
  );
}
