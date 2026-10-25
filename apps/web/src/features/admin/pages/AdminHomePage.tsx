import { Link } from 'react-router-dom';
import {
  ADMIN_SECTION_GROUPS,
  ADMIN_SECTION_GROUP_LABELS,
  ADMIN_SECTIONS,
  adminBadgeCount,
  adminSectionsFor,
  type AdminCounts,
  type AdminSectionKey,
} from '@utmmsc/shared';
import { useLabels } from '../../../shared/i18n/locale';
import { useSessionStore } from '../../../shared/session/store';
import { AdminScreen } from '../layout/AdminScreen';
import { useInsetGroups, useIsDesktop } from '../layout/media';
import { overviewFacts, pendingItems, quickActionsFor, sectionValue, type QuickAction } from '../sections';
import { useAdminCounts, useAdminSummary } from '../state/summaryStore';
import { AdminCell, AdminGroup } from '../ui/AdminCell';
import { LoadFailed } from '../ui/Feedback';
import { AdminIcon, IconTile } from '../ui/icons';

const PENDING_ICON: Record<string, AdminSectionKey> = {
  pendingApplications: 'review',
  pendingYearRequests: 'review',
  openReports: 'reports',
};

/**
 * 待处理, first on the page: one row per kind of work waiting, linking to where it is done, or a line saying nothing
 * is waiting. Hidden when the server has no summary yet (counts unknown is not the same as nothing waiting).
 * 「待处理」，位于页面最上方：每类等待处理的事项一行，链接到处理它的地方；没有待办时显示一句说明。服务器尚无摘要时隐藏（不知道计数不等于
 * 没有待办）。
 */
function PendingGroup() {
  const { tr } = useLabels();
  const counts = useAdminCounts();
  const status = useAdminSummary((s) => s.status);
  if (status === 'unavailable') return null;
  const title = tr('待处理', 'Needs attention');
  if (!counts) {
    if (status === 'failed') return <LoadFailed error={null} onRetry={() => void useAdminSummary.getState().refresh({ force: true })} />;
    return (
      <AdminGroup title={title}>
        <div role="status" aria-label={tr('加载中', 'Loading')} className="flex h-14 items-center px-4">
          <span className="block h-3.5 w-1/2 animate-pulse rounded bg-stone-200 motion-reduce:animate-none" />
        </div>
      </AdminGroup>
    );
  }
  const items = pendingItems(counts);
  return (
    <AdminGroup title={title} inset="icon">
      {items.length === 0 ? (
        <AdminCell leading={<IconTile name="check" tone="muted" />} label={tr('暂时没有需要处理的事', 'Nothing needs your attention right now')} />
      ) : (
        items.map((item) => (
          <AdminCell
            key={item.key}
            to={item.path}
            leading={<IconTile name={PENDING_ICON[item.key] ?? 'review'} tone="gold" />}
            label={tr(item.zh, item.en)}
            count={item.count}
          />
        ))
      )}
    </AdminGroup>
  );
}

/** 快捷操作: tiles on phones, a row of buttons on desktop; only what the viewed role may do. */
/** 「快捷操作」：手机上是图块，桌面上是一排按钮；只显示当前视角的身份可以做的事。 */
function QuickActions({ actions }: { actions: readonly QuickAction[] }) {
  const { tr } = useLabels();
  const desktop = useIsDesktop();
  return (
    <AdminGroup title={tr('快捷操作', 'Quick actions')}>
      <div className={desktop ? 'flex flex-wrap gap-2 p-3' : 'grid grid-cols-4 gap-1 px-2 py-3'}>
        {actions.map((action) =>
          desktop ? (
            <Link
              key={action.key}
              to={action.path}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-brand-50 px-3.5 text-[15px] font-medium text-brand-800 hover:bg-brand-100 active:bg-brand-100"
            >
              <AdminIcon name="plus" className="h-[18px] w-[18px]" strokeWidth={2} />
              {tr(action.zh, action.en)}
            </Link>
          ) : (
            <Link key={action.key} to={action.path} className="flex min-h-[76px] flex-col items-center justify-center gap-1.5 rounded-lg px-1 active:bg-wx-pressed">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-50 text-brand-800">
                <AdminIcon name={action.section} className="h-5 w-5" />
              </span>
              <span className="text-center text-[12px] leading-tight text-wx-ink">{tr(action.zh, action.en)}</span>
            </Link>
          ),
        )}
      </div>
    </AdminGroup>
  );
}

/** Phones: every section the role sees, grouped as in the sidebar, with its value and red count. */
/** 手机：该身份能看到的所有板块，按侧边栏的方式分组，并带有取值和红色数字。 */
function SectionGroups({ sections, counts }: { sections: readonly AdminSectionKey[]; counts: AdminCounts | null }) {
  const { tr } = useLabels();
  return (
    <>
      {ADMIN_SECTION_GROUPS.map((group) => {
        const items = ADMIN_SECTIONS.filter((section) => section.group === group && sections.includes(section.key));
        if (items.length === 0) return null;
        const label = ADMIN_SECTION_GROUP_LABELS[group];
        return (
          <AdminGroup key={group} title={tr(label.zh, label.en)} inset="icon">
            {items.map((section) => {
              const value = counts ? sectionValue(section.key, counts) : null;
              const badge = counts ? adminBadgeCount(section.key, counts) : 0;
              return (
                <AdminCell
                  key={section.key}
                  to={section.path}
                  leading={<IconTile name={section.key} />}
                  label={tr(section.zh, section.en)}
                  value={value ? tr(value.zh, value.en) : undefined}
                  count={badge}
                  spoken={badge > 0 ? tr(`，${badge} 项待处理`, `, ${badge} waiting`) : undefined}
                />
              );
            })}
          </AdminGroup>
        );
      })}
    </>
  );
}

/**
 * 管理首页: pending work first, then quick actions, then (on phones) every section with its count. On desktop the
 * sidebar is the navigation, so the page ends with the 概况 line instead.
 * 「管理首页」：先是待处理的事项，然后是快捷操作，然后（在手机上）是所有板块及其计数。桌面上侧边栏即导航，因此页面以「概况」一行结束。
 */
export function AdminHomePage() {
  const { tr, role: roleLabel } = useLabels();
  const member = useSessionStore((s) => s.member);
  const counts = useAdminCounts();
  const desktop = useIsDesktop();
  const insetGroups = useInsetGroups();
  if (!member) return null;
  const sections = adminSectionsFor(member.role);
  const quick = quickActionsFor(member.role);
  const showsPending = sections.includes('review') || sections.includes('reports');
  const facts = counts ? overviewFacts(counts) : [];

  return (
    <AdminScreen title={tr('管理', 'Admin')} back={{ to: '/discover', label: tr('发现', 'Discover') }} top>
      {showsPending ? <PendingGroup /> : null}
      {quick.length > 0 ? <QuickActions actions={quick} /> : null}
      {desktop ? (
        facts.length > 0 ? (
          <AdminGroup title={tr('概况', 'At a glance')}>
            <p className="px-4 py-3.5 text-[15px] text-wx-ink">{facts.map((fact) => tr(fact.zh, fact.en)).join(' · ')}</p>
          </AdminGroup>
        ) : null
      ) : (
        <SectionGroups sections={sections} counts={counts} />
      )}
      <p className={`pt-4 text-[13px] leading-relaxed text-wx-meta ${insetGroups ? 'px-1' : 'px-4'}`}>
        {tr(`当前身份：${roleLabel(member.role)}。能看到哪些板块由你的身份决定。`, `Your role: ${roleLabel(member.role)}. Which sections you see depends on your role.`)}
      </p>
    </AdminScreen>
  );
}
