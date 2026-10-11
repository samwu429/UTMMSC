import { useState } from 'react';
import { Link } from 'react-router-dom';
import { hasPermission, type Permission } from '@utmmsc/shared';
import { useSessionStore } from '../../../shared/session/store';
import { PageTitle } from '../../../shared/ui/Card';
import { AnnouncementsPanel } from '../announcements/AnnouncementsPanel';
import { ApprovalsPanel } from '../approvals/ApprovalsPanel';
import { ChannelsPanel } from '../channels/ChannelsPanel';
import { EventsPanel } from '../events/EventsPanel';
import { RolesPanel } from '../roles/RolesPanel';

interface Section {
  key: string;
  label: string;
  permission: Permission;
  render: () => JSX.Element;
}

const SECTIONS: Section[] = [
  { key: 'approvals', label: '待审核', permission: 'members.approve', render: () => <ApprovalsPanel /> },
  { key: 'roles', label: '成员身份', permission: 'members.assign_role', render: () => <RolesPanel /> },
  { key: 'channels', label: '频道', permission: 'channels.manage', render: () => <ChannelsPanel /> },
  { key: 'events', label: '活动', permission: 'events.manage', render: () => <EventsPanel /> },
  { key: 'announcements', label: '公告', permission: 'announcements.send', render: () => <AnnouncementsPanel /> },
];

/** Admin home shows only the sections the signed-in role may use, as large tabs. */
/** 管理首页只显示当前身份可用的板块，以大标签呈现。 */
export function AdminPage() {
  const member = useSessionStore((s) => s.member);
  const sections = SECTIONS.filter((s) => member && hasPermission(member.role, s.permission));
  const [active, setActive] = useState(sections[0]?.key ?? '');
  const current = sections.find((s) => s.key === active) ?? sections[0];

  return (
    <div className="space-y-4">
      <PageTitle
        action={
          <Link to="/settings" className="text-sm text-brand-800">
            我的账号
          </Link>
        }
      >
        管理
      </PageTitle>
      <div className="flex gap-5 overflow-x-auto border-b border-stone-200">
        {sections.map((s) => (
          <button
            key={s.key}
            onClick={() => setActive(s.key)}
            className={`-mb-px shrink-0 border-b-[3px] pb-2 text-[15px] ${current?.key === s.key ? 'border-gold font-medium text-brand-800' : 'border-transparent text-stone-500'}`}
          >
            {s.label}
          </button>
        ))}
      </div>
      {current ? current.render() : null}
    </div>
  );
}
