import { Link } from 'react-router-dom';
import { channelRoomId, type ChannelSummary } from '@utmmsc/shared';
import { formatRelative } from '../../../shared/format/time';
import { useTr } from '../../../shared/i18n/locale';
import { EmptyState, List } from '../../../shared/ui/Card';
import { UnreadDot } from '../components/UnreadDot';

export function ChannelList({ channels }: { channels: ChannelSummary[] }) {
  const tr = useTr();
  if (channels.length === 0) return <EmptyState>{tr('还没有可见的频道', 'No channels yet')}</EmptyState>;
  return (
    <List>
      {channels.map((ch) => (
        <Link key={ch.id} to={`/chat/room/${encodeURIComponent(channelRoomId(ch.id))}`} className="flex items-center gap-3 px-4 py-3 active:bg-stone-50">
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{ch.name}</p>
            <p className="truncate text-sm text-stone-500">{ch.description || ' '}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className="text-xs text-stone-400">{formatRelative(ch.lastMessageAt)}</span>
            <UnreadDot count={ch.unreadCount} />
          </div>
        </Link>
      ))}
    </List>
  );
}
