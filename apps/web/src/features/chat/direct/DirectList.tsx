import { Link } from 'react-router-dom';
import { directRoomId, type DirectConversationSummary } from '@utmmsc/shared';
import { formatRelative } from '../../../shared/format/time';
import { EmptyState, List } from '../../../shared/ui/Card';
import { UnreadDot } from '../components/UnreadDot';

export function DirectList({ conversations }: { conversations: DirectConversationSummary[] }) {
  if (conversations.length === 0) {
    return (
      <EmptyState>
        还没有私聊。到{' '}
        <Link to="/directory" className="text-brand-800">
          成员
        </Link>{' '}
        里点一个人即可开始。
      </EmptyState>
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
              <span className="ml-1.5 text-xs font-normal text-stone-400">{dm.peer.graduationYear} 届</span>
            </p>
            <p className="truncate text-sm text-stone-500">{dm.lastPreview ?? '开始聊天'}</p>
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
