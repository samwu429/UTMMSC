import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ChatOverviewResponse } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { Notice, PageTitle, Spinner } from '../../../shared/ui/Card';
import { DirectoryPage } from '../../directory/pages/DirectoryPage';
import { chatApi } from '../api';
import { ChannelList } from '../channels/ChannelList';
import { DirectList } from '../direct/DirectList';

type Tab = 'channels' | 'direct' | 'members';

function tabFromQuery(value: string | null): Tab {
  if (value === 'direct' || value === 'members') return value;
  return 'channels';
}

export function ChatOverviewPage() {
  const [params, setParams] = useSearchParams();
  const tab = tabFromQuery(params.get('tab'));
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

  function select(next: Tab) {
    setParams(next === 'channels' ? {} : { tab: next }, { replace: true });
  }

  return (
    <div>
      <PageTitle>聊天</PageTitle>
      <div className="-mx-4 border-b border-stone-200 bg-white">
        <div className="flex">
        {(
          [
            ['channels', '频道', unreadChannels],
            ['direct', '私聊', unreadDirect],
            ['members', '成员', 0],
          ] as const
        ).map(([key, label, unread]) => (
          <button
            key={key}
            onClick={() => select(key)}
            className={`-mb-px flex-1 border-b-[3px] pb-2 pt-2 text-[15px] ${tab === key ? 'border-gold font-medium text-brand-800' : 'border-transparent text-stone-500'}`}
          >
            {label}
            {unread > 0 ? <span className="ml-1 text-xs text-stone-400">{unread}</span> : null}
          </button>
        ))}
        </div>
      </div>
      <div className="mt-2">
      {tab === 'members' ? <DirectoryPage embedded /> : null}
      {tab !== 'members' && error ? <Notice tone="error">{error}</Notice> : null}
      {tab !== 'members' && !data && !error ? <Spinner /> : null}
      {tab !== 'members' && data ? (tab === 'channels' ? <ChannelList channels={data.channels} /> : <DirectList conversations={data.direct} />) : null}
      </div>
    </div>
  );
}
