import { memo, useDeferredValue, useMemo, useRef } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import type { AdminChannelRow } from '@utmmsc/shared';
import { formatChatListTime } from '../../../shared/format/time';
import { useLabels } from '../../../shared/i18n/locale';
import { ChannelIcon } from '../../chat/list/ChannelIcon';
import { AdminScreen, useSectionBack } from '../layout/AdminScreen';
import { useListKeyboard } from '../layout/listKeyboard';
import { useIsWide } from '../layout/media';
import { plural } from '../sections';
import { AdminGroup } from '../ui/AdminCell';
import { FilterChips } from '../ui/Choices';
import { EmptyBlock, LoadFailed } from '../ui/Feedback';
import { AdminIcon } from '../ui/icons';
import { ListSkeleton } from '../ui/ListSkeleton';
import { SearchBar } from '../ui/SearchBar';
import { StatusBadge } from '../ui/StatusBadge';
import { useChannels } from './channelData';
import { HEADER_ACTION } from './channelParts';
import {
  CHANNEL_FILTERS,
  CHANNEL_FILTER_LABELS,
  audienceLabel,
  channelFilterCounts,
  channelSearchText,
  channelsPath,
  matchesChannelFilter,
  matchesChannelQuery,
  newChannelPath,
  postPolicyLabel,
  readChannelFilter,
  sortChannels,
  type ChannelFilter,
} from './channelForm';


/**
 * One channel: its 40 px icon, the name with the last activity, and who sees it and who may post, with badges for
 * 新成员可看历史 and 仅负责人发言. When the staff-only badge shows, the line leaves the posting rule out instead of
 * saying it twice, which keeps the line readable on a phone. The badges stay on that line while they fit and move to
 * their own line when they do not, so they never squeeze who can see the channel.
 * 单个频道：40px 图标，名称及最近活动时间，谁能看到、谁能发言，以及「新成员可看历史」和「仅负责人发言」标记。显示仅负责人发言标记时，
 * 这一行不再重复发言规则，在手机上更易读。标记放得下时与这一行并排，放不下时另起一行，因此不会挤压「谁能看到」的文字。
 */
const ChannelRow = memo(function ChannelRow({ channel, to, replace, selected }: { channel: AdminChannelRow; to: string; replace: boolean; selected: boolean }) {
  const { tr, locale } = useLabels();
  const audience = audienceLabel(channel.audience);
  const parts = [tr(audience.zh, audience.en)];
  if (channel.audience === 'custom') {
    const n = channel.memberIds.length;
    parts.push(tr(`${n} 人`, plural(n, 'person', 'people')));
  }
  const staffOnly = channel.postPolicy === 'staff';
  if (!staffOnly) {
    const policy = postPolicyLabel(channel.postPolicy);
    parts.push(tr(policy.zh, policy.en));
  }
  const activity = channel.lastMessageAt ? formatChatListTime(channel.lastMessageAt, Date.now(), locale) : tr('无消息', 'No messages');
  return (
    <Link
      to={to}
      replace={replace}
      aria-current={selected ? 'true' : undefined}
      data-admin-row={channel.id}
      className={`relative block w-full text-left outline-offset-[-2px] [contain-intrinsic-size:auto_64px] [content-visibility:auto] active:bg-wx-pressed ${selected ? 'bg-brand-50' : ''}`}
    >
      <span className="flex min-h-16 items-center gap-3 px-4 py-2.5">
        <ChannelIcon name={channel.name} iconKey={channel.iconKey} size={40} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className={`min-w-0 flex-1 truncate text-[17px] leading-6 ${selected ? 'font-medium text-brand-800' : 'text-wx-ink'}`}>{channel.name}</span>
            <span className="shrink-0 text-[13px] tabular-nums text-wx-meta">{activity}</span>
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <span className="min-w-0 max-w-full truncate text-[14px] leading-5 text-wx-meta">{parts.join(' · ')}</span>
            {channel.historyVisibility === 'all' ? <StatusBadge tone="brand">{tr('新成员可看历史', 'History visible')}</StatusBadge> : null}
            {staffOnly ? <StatusBadge tone="muted">{tr('仅负责人发言', 'Staff post only')}</StatusBadge> : null}
          </span>
        </span>
        <AdminIcon name="chevron" className="h-4 w-4 shrink-0 text-stone-400" strokeWidth={2} />
      </span>
      {selected ? <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-gold" /> : null}
    </Link>
  );
});

/**
 * 频道: every channel, most recent activity first, with search (?q=) and the chips 全部 / 按身份开放 / 指定成员 (?f=).
 * Each row opens the channel's settings; 新建 opens the create form. The member list is not loaded here.
 * 「频道」：全部频道，最近活动在前，带搜索（?q=）和「全部 / 按身份开放 / 指定成员」筛选标签（?f=）。每一行打开该频道的设置；「新建」打开
 * 新建表单。这里不加载成员列表。
 */
export function ChannelList({ selectedId }: { selectedId: string | null }) {
  const { tr, locale } = useLabels();
  const back = useSectionBack();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const filter = readChannelFilter(params.get('f'));
  const deferredQuery = useDeferredValue(query);
  const channels = useChannels();
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useListKeyboard(listRef, searchRef);
  // In the split view, picking another channel replaces the one shown, so back and Esc return to the list in one step.
  // 在分栏视图中，选择另一个频道会替换正在显示的频道，因此返回和 Esc 一步就回到列表。
  const swap = useIsWide() && selectedId !== null;

  const index = useMemo(() => sortChannels(channels.data ?? [], locale).map((channel) => ({ channel, text: channelSearchText(channel) })), [channels.data, locale]);
  const counts = useMemo(() => channelFilterCounts(channels.data ?? []), [channels.data]);
  const shown = useMemo(
    () => index.filter((entry) => matchesChannelFilter(entry.channel, filter) && matchesChannelQuery(entry.text, deferredQuery)).map((entry) => entry.channel),
    [index, filter, deferredQuery],
  );

  function update(key: 'q' | 'f', value: string) {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  }

  const chips = CHANNEL_FILTERS.map((value) => ({ value, label: tr(CHANNEL_FILTER_LABELS[value].zh, CHANNEL_FILTER_LABELS[value].en), count: channels.data ? counts[value] : null }));
  const sub = (
    <>
      <SearchBar ref={searchRef} value={query} onChange={(next) => update('q', next.trim() ? next : '')} placeholder={tr('搜索频道', 'Search channels')} />
      <div className="pb-1.5">
        <FilterChips<ChannelFilter> label={tr('筛选频道', 'Filter channels')} options={chips} value={filter} onChange={(next) => update('f', next === 'all' ? '' : next)} />
      </div>
    </>
  );
  const trailing = (
    <Link to={newChannelPath(location.search)} replace={swap} className={HEADER_ACTION}>
      {tr('新建', 'New')}
    </Link>
  );

  let body;
  if (!channels.data) {
    body = channels.error ? <LoadFailed error={channels.error} onRetry={() => void channels.refresh()} /> : <ListSkeleton rows={5} avatar />;
  } else if (channels.data.length === 0) {
    body = (
      <EmptyBlock
        title={tr('还没有频道', 'No channels yet')}
        action={
          <Link to={newChannelPath(location.search)} className="inline-flex min-h-11 items-center rounded-lg border-t-[3px] border-gold bg-brand-800 px-4 text-[15px] font-medium text-white">
            {tr('新建频道', 'New channel')}
          </Link>
        }
      />
    );
  } else if (shown.length === 0) {
    body = (
      <EmptyBlock
        title={deferredQuery.trim() ? tr(`没有找到「${deferredQuery.trim()}」`, `No channels match "${deferredQuery.trim()}"`) : tr('这里还没有频道', 'No channels here yet')}
      />
    );
  } else {
    body = (
      <>
        {channels.error ? <LoadFailed error={channels.error} onRetry={() => void channels.refresh()} /> : null}
        <AdminGroup inset="avatar">
          {shown.map((channel) => (
            <ChannelRow key={channel.id} channel={channel} to={channelsPath(channel.id, null, location.search)} replace={swap} selected={channel.id === selectedId} />
          ))}
        </AdminGroup>
      </>
    );
  }

  return (
    <AdminScreen title={tr('频道', 'Channels')} count={channels.data?.length ?? null} back={back} top trailing={trailing} sub={sub}>
      <div ref={listRef}>{body}</div>
    </AdminScreen>
  );
}
