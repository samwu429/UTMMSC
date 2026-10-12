import { Link, useNavigate } from 'react-router-dom';
import { directRoomId, isHonoraryRole, showsEnrollment, type DirectConversationSummary } from '@utmmsc/shared';
import { formatRelative } from '../../../shared/format/time';
import { useLabels } from '../../../shared/i18n/locale';
import { Button } from '../../../shared/ui/Button';
import { EmptyState, List } from '../../../shared/ui/Card';
import { UnreadDot } from '../components/UnreadDot';

export function DirectList({ conversations }: { conversations: DirectConversationSummary[] }) {
  const navigate = useNavigate();
  const { tr, role, year } = useLabels();
  if (conversations.length === 0) {
    return (
      <div>
        <EmptyState>{tr('还没有私聊。加了好友之后，才能在这里发私信。', 'No direct messages yet. Add a friend first.')}</EmptyState>
        <Button variant="secondary" block onClick={() => navigate('/chat?tab=members')}>
          {tr('去加好友', 'Add a friend')}
        </Button>
      </div>
    );
  }
  return (
    <List>
      {conversations.map((dm) => (
        <Link key={dm.id} to={`/chat/room/${encodeURIComponent(directRoomId(dm.id))}`} className="flex items-center gap-3 px-4 py-3 active:bg-stone-50">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-stone-200 text-sm font-medium text-stone-700">
            {dm.peer.displayName.slice(0, 1)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">
              {dm.peer.displayName}
              <span className="ml-1.5 text-xs font-normal text-stone-400">
                {showsEnrollment(dm.peer.role)
                  ? `${year(dm.peer.graduationYear)}${isHonoraryRole(dm.peer.role) ? ` · ${role(dm.peer.role)}` : ''}`
                  : role(dm.peer.role)}
              </span>
            </p>
            <p className="truncate text-sm text-stone-500">{dm.lastPreview ?? tr('开始聊天', 'Start chatting')}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className="text-xs text-stone-400">{formatRelative(dm.lastMessageAt)}</span>
            <UnreadDot count={dm.unreadCount} />
          </div>
        </Link>
      ))}
    </List>
  );
}
