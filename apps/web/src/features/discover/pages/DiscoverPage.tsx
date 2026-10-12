import { Link } from 'react-router-dom';
import { hasPermission } from '@utmmsc/shared';
import { useSessionStore } from '../../../shared/session/store';
import { List, PageTitle } from '../../../shared/ui/Card';

function Row({ to, title, hint }: { to: string; title: string; hint: string }) {
  return (
    <Link to={to} className="flex items-center justify-between px-4 py-3.5 active:bg-stone-50">
      <span>
        <span className="block font-medium text-brand-800">{title}</span>
        <span className="text-sm text-stone-500">{hint}</span>
      </span>
      <span className="text-stone-300">›</span>
    </Link>
  );
}

export function DiscoverPage() {
  const member = useSessionStore((s) => s.member);
  const staff =
    member &&
    (hasPermission(member.role, 'members.approve') ||
      hasPermission(member.role, 'channels.manage') ||
      hasPermission(member.role, 'events.manage'));

  return (
    <div>
      <PageTitle>发现</PageTitle>
      <List>
        <Row to="/discover/feed" title="好友动态" hint="成员的近况、照片和视频" />
        <Row to="/files" title="文件" hint="社团资料" />
        {staff ? <Row to="/admin" title="管理" hint="审核、频道、活动和公告" /> : null}
      </List>
    </div>
  );
}
