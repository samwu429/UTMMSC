import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { adminPendingTotal, canOpenAdmin } from '@utmmsc/shared';
import { useTr } from '../../../shared/i18n/locale';
import { useSessionStore } from '../../../shared/session/store';
import { List, PageTitle } from '../../../shared/ui/Card';
import { UnreadDot } from '../../chat/components/UnreadDot';
import { useAdminCounts, useAdminSummary } from '../../admin/state/summaryStore';
import { useMomentsBadge } from '../../moments/state/badgeStore';
import { MemberAvatar } from '../../profile/InitialAvatar';
import { ChevronIcon } from '../../profile/icons';

function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

function Row({ to, title, icon, trailing, spoken }: { to: string; title: string; icon: ReactNode; trailing?: ReactNode; spoken?: string }) {
  return (
    <Link to={to} className="flex min-h-[56px] items-center gap-3 px-4 active:bg-stone-50">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-800 text-white">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-[16px]">
        {title}
        {spoken ? <span className="sr-only">{spoken}</span> : null}
      </span>
      {trailing}
      <span className="text-stone-300">
        <ChevronIcon />
      </span>
    </Link>
  );
}

/**
 * What the 好友动态 row shows at its end, as in WeChat: the latest actor's avatar with the unread number, or the
 * latest author's avatar with a dot when friends posted something new. A moderator's removal has no actor, so
 * the number then stands alone.
 * 「好友动态」一行末尾显示的内容，与微信一致：最近互动者的头像加未读数，或者在好友有新动态时显示最近发布者的头像加红点。
 * 管理员移除没有操作者，此时只显示数字。
 */
function MomentsBadge() {
  const unread = useMomentsBadge((s) => s.unread);
  const newPosts = useMomentsBadge((s) => s.newPosts);
  const latestActor = useMomentsBadge((s) => s.latestActor);
  const latestAuthor = useMomentsBadge((s) => s.latestAuthor);
  const person = unread > 0 ? latestActor : newPosts > 0 ? latestAuthor : null;

  if (!person) return unread > 0 ? <UnreadDot count={unread} className="mr-1" /> : null;
  return (
    <span className="relative mr-1.5 inline-flex" aria-hidden>
      <MemberAvatar name={person.displayName} avatarKey={person.avatarKey} shape="square" className="h-8 w-8 text-xs" />
      <UnreadDot
        count={unread}
        dot={unread === 0}
        className={`absolute shadow-[0_0_0_1.5px_#fff] ${unread > 0 ? '-right-2 -top-2' : '-right-1 -top-1'}`}
      />
    </span>
  );
}

export function DiscoverPage() {
  const tr = useTr();
  const member = useSessionStore((s) => s.member);
  const unread = useMomentsBadge((s) => s.unread);
  const newPosts = useMomentsBadge((s) => s.newPosts);
  // The same registry as admin itself, by the viewed role: 管理 shows when the role sees at least one section.
  // 与管理后台本身使用同一个权限表，按当前视角的身份判断：该身份至少能看到一个板块时才显示「管理」。
  const admin = canOpenAdmin(member);
  const counts = useAdminCounts();
  const pending = admin && counts ? adminPendingTotal(counts) : 0;

  // Every visit asks again, so the row is current when the member decides whether to open it. A change of viewed
  // role empties the summary, so it asks again then too.
  // 每次进入都重新查询，成员决定是否打开时这一行是最新的。切换视角身份会清空汇总，因此那时也重新查询。
  const role = member?.role;
  useEffect(() => {
    void useMomentsBadge.getState().refresh();
  }, []);
  useEffect(() => {
    if (admin) void useAdminSummary.getState().refresh();
  }, [admin, role]);

  return (
    <div>
      <PageTitle>{tr('发现', 'Discover')}</PageTitle>
      <List>
        <Row
          to="/discover/feed"
          title={tr('好友动态', 'Friend updates')}
          trailing={<MomentsBadge />}
          spoken={unread > 0 ? tr(`，${unread} 条新消息`, `, ${unread} new`) : newPosts > 0 ? tr('，有新动态', ', new updates') : undefined}
          icon={
            <Glyph>
              <path d="M4 8.5h3l1.2-2h7.6L17 8.5h3v9H4v-9Z" />
              <circle cx="12" cy="12.5" r="2.2" />
            </Glyph>
          }
        />
        <Row
          to="/files"
          title={tr('文件', 'Files')}
          icon={
            <Glyph>
              <path d="M7 3.5h7l5 5V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" />
              <path d="M14 3.5v5h5" />
            </Glyph>
          }
        />
      </List>
      {admin ? (
        <div className="mt-2">
          <List>
            <Row
              to="/admin"
              title={tr('管理', 'Admin')}
              trailing={pending > 0 ? <UnreadDot count={pending} className="mr-1" /> : undefined}
              spoken={pending > 0 ? tr(`，${pending} 项待处理`, `, ${pending} waiting`) : undefined}
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
