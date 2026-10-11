import { Link } from 'react-router-dom';
import { directRoomId, type DirectConversationSummary } from '@utmmsc/shared';
import { formatRelative } from '../../../shared/format/time';
import { EmptyState } from '../../../shared/ui/Card';
import { UnreadDot } from '../components/UnreadDot';

export function DirectList({ conversations }: { conversations: DirectConversationSummary[] }) {
  if (conversations.length === 0) {
    return (
      <EmptyState>
        还没有私聊。到{' '}
        <Link to="/directory" className="text-brand-700 underline">
          成员列表
        </Link>{' '}
        找人开始聊天。
      </EmptyState>
    );
  }
  return (
    <div className="space-y-2">
      {conversations.map((dm) => (
        <Link key={dm.id} to={`/chat/room/${encodeURIComponent(directRoomId(dm.id))}`} className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-sm">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-100 text-lg font-semibold text-brand-800">
            {dm.peer.displayName.slice(0, 1)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">
              {dm.peer.displayName} <span className="text-xs font-normal text-slate-400">{dm.peer.graduationYear} 届</span>
            </p>
            <p className="truncate text-sm text-slate-500">{dm.lastPreview ?? '开始聊天'}</p>
          </div>
          <div className="flex flex-col items-end gap-1 text-xs text-slate-400">
            <span>{formatRelative(dm.lastMessageAt)}</span>
            <UnreadDot count={dm.unreadCount} />
          </div>
        </Link>
      ))}
    </div>
  );
}
