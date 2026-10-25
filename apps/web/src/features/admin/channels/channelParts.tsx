import { useEffect, useId, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { channelRoomId, type AdminChannelRow, type HistoryVisibility } from '@utmmsc/shared';
import { useTr } from '../../../shared/i18n/locale';
import { Switch } from '../../chat/info/Switch';
import { roomLink } from '../../chat/list/conversations';
import type { BackTarget } from '../layout/AdminScreen';
import { adminHistory } from '../layout/adminHistory';
import type { Phrase } from '../sections';
import { useHeldValue } from '../state/useHeldValue';
import { AdminCell, AdminGroup } from '../ui/AdminCell';
import { EmptyBlock, LoadFailed } from '../ui/Feedback';
import { ListSkeleton } from '../ui/ListSkeleton';
import { useChannel } from './channelData';
import { channelsPath } from './channelForm';

/** A text action at the end of a title bar, such as 新建 or 保存. */
/** 标题栏末尾的文字操作，例如「新建」或「保存」。 */
export const HEADER_ACTION = 'inline-flex min-h-11 items-center rounded-lg px-2.5 text-[16px] font-medium text-brand-800 active:bg-stone-100 disabled:text-stone-400';

/** A text field of the admin forms: 16 px so iOS does not zoom. */
/** 管理后台表单的文本框：16px，iOS 因此不会缩放。 */
export const FIELD = 'w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-[16px] text-stone-900 outline-none focus:border-brand-800 focus:ring-2 focus:ring-brand-100';

/** Characters used against the limit, as the server counts them. */
/** 已用字数与上限，按服务器的方式计数。 */
export function Counter({ value, max, id }: { value: string; max: number; id?: string }) {
  const over = value.length > max;
  return (
    <span id={id} aria-live="polite" className={`shrink-0 text-[13px] tabular-nums ${over ? 'text-red-700' : 'text-wx-meta'}`}>
      {value.length}/{max}
    </span>
  );
}

/**
 * The owner's history switch. Off is WeChat's rule: someone who joins later only sees messages from their join on.
 * Turning it off again grandfathers everyone who is in the channel at that moment.
 * 负责人可调的历史消息开关。关闭时与微信一致：之后加入的人只能看到加入之后的消息。重新关闭时，当时已在频道里的人都保留原有的可见范围。
 */
export function HistoryGroup({ value, onChange, disabled = false }: { value: HistoryVisibility; onChange: (next: HistoryVisibility) => void; disabled?: boolean }) {
  const tr = useTr();
  const labelId = useId();
  const on = value === 'all';
  return (
    <AdminGroup
      footer={tr(
        '关闭时与微信一致：新成员只能看到加入之后的消息。已在频道里的成员不受影响。',
        'Off matches WeChat: new members only see messages sent after they join. Current members are not affected.',
      )}
    >
      <AdminCell
        label={<span id={labelId}>{tr('新成员可查看历史消息', 'New members can see earlier messages')}</span>}
        trailing={
          <span className={disabled ? 'pointer-events-none opacity-60' : undefined}>
            <Switch checked={on} labelledBy={labelId} onChange={(next) => onChange(next ? 'all' : 'since_join')} />
          </span>
        }
      />
    </AdminGroup>
  );
}

/** The list's address with its query, and the settings of a channel, where every editor returns. */
/** 带查询参数的列表地址，以及频道设置的地址（每个编辑界面都返回到这里）。 */
export function useChannelPaths(id: string) {
  const tr = useTr();
  const { search } = useLocation();
  const list = channelsPath(null, null, search);
  const settings = channelsPath(id, null, search);
  return {
    search,
    list,
    settings,
    listBack: { to: list, label: tr('频道', 'Channels') } satisfies BackTarget,
    settingsBack: { to: settings, label: tr('频道设置', 'Channel settings') } satisfies BackTarget,
  };
}

/**
 * Where a channel's settings go back to. Chat info opens them from outside admin, and back then pops that entry, so
 * one step returns to chat info; otherwise it is the channel list.
 * 频道设置的返回目标。聊天信息从管理后台之外打开设置，此时返回会弹出这条记录，一步回到聊天信息；其他情况返回频道列表。
 */
export function settingsBackTarget(id: string, fromOutside: boolean, search = ''): { to: string; label: Phrase } {
  if (fromOutside) return { to: `${roomLink(channelRoomId(id))}/info`, label: { zh: '聊天信息', en: 'Chat info' } };
  return { to: channelsPath(null, null, search), label: { zh: '频道', en: 'Channels' } };
}

/**
 * The back button of a channel's settings. AdminLayout records this entry in a layout effect that runs after this
 * screen's render and layout effects, so where it came from is read in an effect.
 * 频道设置的返回按钮。AdminLayout 在布局副作用中记录这条记录，晚于本界面的渲染和布局副作用，因此在副作用中读取它从哪里来。
 */
export function useSettingsBack(id: string): BackTarget {
  const tr = useTr();
  const { key, search } = useLocation();
  const [fromOutside, setFromOutside] = useState(false);
  useEffect(() => setFromOutside(adminHistory.enteredFromOutside(key)), [key]);
  const target = settingsBackTarget(id, fromOutside, search);
  return { to: target.to, label: tr(target.label.zh, target.label.en) };
}

function MissingChannel({ list }: { list: string }) {
  const tr = useTr();
  return (
    <EmptyBlock
      title={tr('找不到这个频道', "This channel couldn't be found")}
      hint={tr('可能已被删除，或链接有误。', 'It may have been deleted, or the link is wrong.')}
      action={
        <Link to={list} replace className="inline-flex min-h-11 items-center rounded-lg px-3 text-[15px] font-medium text-brand-800 active:bg-stone-100">
          {tr('返回频道列表', 'Back to channels')}
        </Link>
      }
    />
  );
}

/**
 * The frame of a channel's screens: the channel, or what to show instead (skeleton rows, a failed load, a channel
 * that is gone). While `holding` (a delete on its way) the last channel seen stays on screen.
 * 频道各界面的外框：频道数据，或代替它显示的内容（骨架行、加载失败、频道已不存在）。`holding` 期间（删除请求进行中）仍显示最近一次看到的频道。
 */
export function useChannelScreen(id: string, holding = false): { channel: AdminChannelRow | undefined; fallback: ReactNode } {
  const lookup = useChannel(id);
  const { list } = useChannelPaths(id);
  const channel = useHeldValue(lookup.channel, holding);
  let fallback: ReactNode = null;
  if (!channel) {
    if (lookup.state === 'missing') fallback = <MissingChannel list={list} />;
    else if (lookup.state === 'failed') fallback = <LoadFailed error={lookup.error} onRetry={lookup.retry} />;
    else fallback = <ListSkeleton rows={5} />;
  }
  return { channel, fallback };
}
