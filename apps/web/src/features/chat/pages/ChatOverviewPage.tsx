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
      <div className="flex gap-5 border-b border-stone-200">
        {(
          [
            ['channels', '频道', unreadChannels],
            ['direct', '私聊', unreadDirect],
          ] as const
        ).map(([key, label, unread]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 pb-2 text-[15px] ${tab === key ? 'border-brand-800 font-medium text-brand-800' : 'border-transparent text-stone-500'}`}
          >
            {label}
            {unread > 0 ? <span className="ml-1 text-xs text-stone-400">{unread}</span> : null}
          </button>
        ))}
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {!data && !error ? <Spinner /> : null}
      {data ? tab === 'channels' ? <ChannelList channels={data.channels} /> : <DirectList conversations={data.direct} /> : null}
    </div>
  );
}
