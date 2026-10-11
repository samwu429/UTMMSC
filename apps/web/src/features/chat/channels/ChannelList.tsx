import { Link } from 'react-router-dom';
import { channelRoomId, type ChannelSummary } from '@utmmsc/shared';
import { formatRelative } from '../../../shared/format/time';
import { EmptyState } from '../../../shared/ui/Card';
import { UnreadDot } from '../components/UnreadDot';

export function ChannelList({ channels }: { channels: ChannelSummary[] }) {
  if (channels.length === 0) return <EmptyState>还没有可见的频道</EmptyState>;
  return (
    <div className="space-y-2">
      {channels.map((ch) => (
        <Link key={ch.id} to={`/chat/room/${encodeURIComponent(channelRoomId(ch.id))}`} className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-sm shadow-brand-900/5 active:bg-brand-50">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-700 text-lg font-semibold text-accent-300">#</div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{ch.name}</p>
            <p className="truncate text-sm text-slate-500">{ch.description ?? ''}</p>
          </div>
          <div className="flex flex-col items-end gap-1 text-xs text-slate-400">
            <span>{formatRelative(ch.lastMessageAt)}</span>
            <UnreadDot count={ch.unreadCount} />
          </div>
        </Link>
      ))}
    </div>
  );
}
