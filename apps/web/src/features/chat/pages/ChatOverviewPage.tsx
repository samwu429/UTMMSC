import { useEffect, useState } from 'react';
import type { ChatOverviewResponse } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { Notice, PageTitle, Spinner } from '../../../shared/ui/Card';
import { chatApi } from '../api';
import { ChannelList } from '../channels/ChannelList';
import { DirectList } from '../direct/DirectList';

type Tab = 'channels' | 'direct';

export function ChatOverviewPage() {
  const [tab, setTab] = useState<Tab>('channels');
  const [data, setData] = useState<ChatOverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      chatApi
        .overview()
        .then((res) => !cancelled && setData(res))
        .catch((err) => !cancelled && setError(errorMessage(err)));
    void load();
    // Refresh unread counts while the list is on screen.
    // 列表在屏幕上时定期刷新未读数。
    const timer = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const unreadDirect = data?.direct.reduce((n, d) => n + d.unreadCount, 0) ?? 0;
  const unreadChannels = data?.channels.reduce((n, c) => n + c.unreadCount, 0) ?? 0;

  return (
    <div className="space-y-4">
      <PageTitle>聊天</PageTitle>
      <div className="flex rounded-xl bg-white p-1 shadow-sm">
        {(
          [
            ['channels', '频道', unreadChannels],
            ['direct', '私聊', unreadDirect],
          ] as const
        ).map(([key, label, unread]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 rounded-lg py-2 text-sm font-medium ${tab === key ? 'bg-brand-700 text-white' : 'text-slate-600'}`}
          >
            {label}
            {unread > 0 ? ` (${unread})` : ''}
          </button>
        ))}
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {!data && !error ? <Spinner /> : null}
      {data ? tab === 'channels' ? <ChannelList channels={data.channels} /> : <DirectList conversations={data.direct} /> : null}
    </div>
  );
}
