import { useEffect, useState } from 'react';
import type { AdminChannelRow } from '@utmmsc/shared';
import { ApiClientError } from '../../../shared/api/errors';
import { useOverviewStore } from '../../chat/state/overviewStore';
import { adminApi } from '../api';
import { adminCache, useAdminQuery, type AdminQuery } from '../state/adminCache';
import { channelPatch, isEmptyPatch, type ChannelDraft } from './channelForm';

/** The cache key of the channel list, and of one channel opened by a link before the list arrived. */
/** 频道列表的缓存键，以及在列表到达之前经链接打开的单个频道的缓存键。 */
export const CHANNELS_KEY = 'channels';

export function channelKey(id: string): string {
  return `channel:${id}`;
}

const loadChannels = async () => (await adminApi.channels()).channels;

export function useChannels(enabled = true): AdminQuery<AdminChannelRow[]> {
  return useAdminQuery(CHANNELS_KEY, loadChannels, { enabled });
}

export type ChannelState = 'ready' | 'loading' | 'missing' | 'failed';

export interface ChannelLookup {
  channel: AdminChannelRow | undefined;
  state: ChannelState;
  error: unknown;
  retry: () => void;
}

function isNotFound(error: unknown): boolean {
  return error instanceof ApiClientError && (error.status === 404 || error.status === 403);
}

/**
 * One channel for its settings screens. The cached list answers when it has the channel. A deep link that arrives
 * before the list asks GET /channels/:id at the same time, so the settings show without waiting for every channel;
 * once the list is in, it decides, so a channel deleted meanwhile reads as missing.
 * 设置界面所用的单个频道。缓存的列表中有该频道时直接使用。在列表到达之前打开的链接会同时请求 GET /channels/:id，设置因此不必等待全部频道；
 * 列表到达之后以列表为准，期间被删除的频道因此显示为不存在。
 */
export function useChannel(id: string): ChannelLookup {
  const list = useChannels();
  const fromList = list.data?.find((item) => item.id === id);
  const single = useAdminQuery<AdminChannelRow>(channelKey(id), async () => (await adminApi.channel(id)).channel, { enabled: list.data === undefined });
  const channel = fromList ?? (list.data === undefined ? single.data : undefined);
  // A cached list may predate a channel another admin just made, so it is asked once more before saying it is gone.
  // 缓存的列表可能早于另一位管理员刚创建的频道，因此在判定频道不存在之前再获取一次列表。
  const [recheckedFor, setRecheckedFor] = useState<string | null>(null);
  const missingFromList = list.data !== undefined && !fromList;
  const refreshList = list.refresh;
  useEffect(() => {
    if (!missingFromList || recheckedFor === id) return;
    setRecheckedFor(id);
    void refreshList();
  }, [missingFromList, recheckedFor, id, refreshList]);
  const retry = () => {
    void list.refresh();
    if (list.data === undefined) void single.refresh();
  };
  if (channel) return { channel, state: 'ready', error: null, retry };
  if (missingFromList && (recheckedFor !== id || list.loading)) return { channel: undefined, state: 'loading', error: null, retry };
  if (list.data !== undefined || isNotFound(single.error)) return { channel: undefined, state: 'missing', error: null, retry };
  if (list.error && single.error) return { channel: undefined, state: 'failed', error: list.error, retry };
  return { channel: undefined, state: 'loading', error: null, retry };
}

/** Puts the server's copy of a channel in the list (first, when new) and in its own entry. */
/** 把服务器返回的频道数据放进列表（新频道放在最前），以及它自己的缓存项。 */
export function storeChannel(next: AdminChannelRow): void {
  adminCache.mutate<AdminChannelRow[]>(CHANNELS_KEY, (list) => {
    if (!list) return list;
    return list.some((item) => item.id === next.id) ? list.map((item) => (item.id === next.id ? next : item)) : [next, ...list];
  });
  if (adminCache.read<AdminChannelRow>(channelKey(next.id)).data !== undefined) adminCache.mutate<AdminChannelRow>(channelKey(next.id), () => next);
}

/** Takes a deleted channel out of the list and its own entry. */
/** 把已删除的频道从列表及其自己的缓存项中移除。 */
export function forgetChannel(id: string): void {
  adminCache.mutate<AdminChannelRow[]>(CHANNELS_KEY, (list) => list?.filter((item) => item.id !== id));
  if (adminCache.read<AdminChannelRow>(channelKey(id)).data !== undefined) adminCache.mutate<AdminChannelRow>(channelKey(id), () => undefined);
}

/**
 * A custom channel just created opens its member picker on top of its settings. The settings screen takes the
 * request once it is on screen, so the history holds list, settings, picker and back walks through them in order;
 * two navigations at once would let the router skip the settings entry.
 * 刚创建的指定成员频道会在其设置之上打开成员选择。设置界面显示之后才取走这个请求，历史中因此依次是列表、设置、成员选择，返回时按顺序经过；
 * 同时发出两次跳转会让路由跳过设置这一条记录。
 */
let memberPickerRequest: string | null = null;

export function requestMemberPicker(channelId: string): void {
  memberPickerRequest = channelId;
}

export function takeMemberPickerRequest(channelId: string): boolean {
  if (memberPickerRequest !== channelId) return false;
  memberPickerRequest = null;
  return true;
}

/** The admin's own chat list shows channel names, icons and existence, so it catches up after a change. */
/** 管理员自己的聊天列表显示频道名称、图标以及频道是否存在，因此在修改之后跟上。 */
export function refreshChatList(): void {
  void useOverviewStore.getState().refresh({ force: true });
}

/**
 * Saves the fields of `change` that differ from `channel`, one PATCH with nothing else in it, and stores the
 * server's answer. Returns the channel as the server now has it; with nothing to send it returns `channel` and asks
 * nothing.
 * 保存 `change` 中与 `channel` 不同的字段：一次只含这些字段的 PATCH，并保存服务器的结果。返回服务器当前的频道数据；没有需要发送的内容时
 * 直接返回 `channel`，不发出请求。
 */
export async function saveChannel(channel: AdminChannelRow, change: Partial<ChannelDraft>): Promise<AdminChannelRow> {
  const patch = channelPatch(channel, change);
  if (isEmptyPatch(patch)) return channel;
  const res = await adminApi.updateChannel(channel.id, patch);
  storeChannel(res.channel);
  if (patch.name !== undefined || patch.audience !== undefined || patch.memberIds !== undefined) refreshChatList();
  return res.channel;
}
