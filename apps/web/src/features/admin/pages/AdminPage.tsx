import { useState } from 'react';
import { hasPermission, type MemberSelf } from '@utmmsc/shared';
import { useTr } from '../../../shared/i18n/locale';
import { useSessionStore } from '../../../shared/session/store';
import { BackHeader } from '../../../shared/ui/BackHeader';
import { AdvisorsPanel } from '../advisors/AdvisorsPanel';
import { AnnouncementsPanel } from '../announcements/AnnouncementsPanel';
import { ApprovalsPanel } from '../approvals/ApprovalsPanel';
import { ChannelsPanel } from '../channels/ChannelsPanel';
import { EventsPanel } from '../events/EventsPanel';
import { RolesPanel } from '../roles/RolesPanel';

interface Section {
  key: string;
  label: string;
  visible: (member: MemberSelf) => boolean;
  render: () => JSX.Element;
}

const SECTIONS: Section[] = [
  { key: 'approvals', label: '待审核', visible: (member) => hasPermission(member.role, 'members.approve'), render: () => <ApprovalsPanel /> },
  { key: 'roles', label: '成员身份', visible: (member) => hasPermission(member.role, 'members.assign_role'), render: () => <RolesPanel /> },
  { key: 'advisors', label: '邀请顾问', visible: (member) => member.realRole === 'superadmin', render: () => <AdvisorsPanel /> },
  { key: 'channels', label: '频道', visible: (member) => hasPermission(member.role, 'channels.manage'), render: () => <ChannelsPanel /> },
  { key: 'events', label: '活动', visible: (member) => hasPermission(member.role, 'events.manage'), render: () => <EventsPanel /> },
  { key: 'announcements', label: '公告', visible: (member) => hasPermission(member.role, 'announcements.send'), render: () => <AnnouncementsPanel /> },
];

/** Admin home shows only the sections the signed-in role may use, as large tabs. */
/** 管理首页只显示当前身份可用的板块，以大标签呈现。 */
const SECTION_EN: Record<string, string> = {
  approvals: 'Pending',
  roles: 'Roles',
  advisors: 'Invite advisors',
  channels: 'Channels',
  events: 'Events',
  announcements: 'Announcements',
};

export function AdminPage() {
  const tr = useTr();
  const member = useSessionStore((s) => s.member);
  const sections = SECTIONS.filter((s) => member && s.visible(member));
  const [active, setActive] = useState(sections[0]?.key ?? '');
  const current = sections.find((s) => s.key === active) ?? sections[0];

  return (
    <div className="space-y-4">
      <BackHeader to="/discover" label={tr('发现', 'Discover')} title={tr('管理', 'Admin')} />
      <div className="flex gap-5 overflow-x-auto border-b border-stone-200">
        {sections.map((s) => (
          <button
            key={s.key}
            onClick={() => setActive(s.key)}
            className={`-mb-px shrink-0 border-b-[3px] pb-2 text-[15px] ${current?.key === s.key ? 'border-gold font-medium text-brand-800' : 'border-transparent text-stone-500'}`}
          >
            {tr(s.label, SECTION_EN[s.key] ?? s.label)}
          </button>
        ))}
      </div>
      {current ? current.render() : null}
    </div>
  );
}
