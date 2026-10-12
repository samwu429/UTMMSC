import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { hasPermission } from '@utmmsc/shared';
import { useSessionStore } from '../../../shared/session/store';
import { List, PageTitle } from '../../../shared/ui/Card';
import { ChevronIcon } from '../../profile/icons';

function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

function Row({ to, title, icon }: { to: string; title: string; icon: ReactNode }) {
  return (
    <Link to={to} className="flex min-h-[56px] items-center gap-3 px-4 active:bg-stone-50">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-800 text-white">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-[16px]">{title}</span>
      <span className="text-stone-300">
        <ChevronIcon />
      </span>
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
        <Row
          to="/discover/feed"
          title="好友动态"
          icon={
            <Glyph>
              <path d="M4 8.5h3l1.2-2h7.6L17 8.5h3v9H4v-9Z" />
              <circle cx="12" cy="12.5" r="2.2" />
            </Glyph>
          }
        />
        <Row
          to="/files"
          title="文件"
          icon={
            <Glyph>
              <path d="M7 3.5h7l5 5V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" />
              <path d="M14 3.5v5h5" />
            </Glyph>
          }
        />
      </List>
      {staff ? (
        <div className="mt-2">
          <List>
            <Row
              to="/admin"
              title="管理"
              icon={
                <Glyph>
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 4.2v1.6M12 18.2v1.6M5.6 6.8l1.1 1.1M17.3 16.1l1.1 1.1M4.2 12h1.6M18.2 12h1.6M5.6 17.2l1.1-1.1M17.3 7.9l1.1-1.1" />
                </Glyph>
              }
            />
          </List>
        </div>
      ) : null}
    </div>
  );
}
