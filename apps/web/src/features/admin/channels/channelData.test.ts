import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdminChannelRow, UpdateChannelBody } from '@utmmsc/shared';
import { adminCache } from '../state/adminCache';
import { CHANNELS_KEY, saveChannel } from './channelData';
import { audienceChoice, memberPickerSave } from './channelForm';

/**
 * What saveChannel sends, with the admin API and the chat list held in place.
 * saveChannel 发送的内容；管理后台 API 和聊天列表都换成替身。
 */
const updateChannel = vi.hoisted(() => vi.fn<(id: string, body: UpdateChannelBody) => Promise<{ channel: AdminChannelRow }>>());

vi.mock('../api', () => ({ adminApi: { updateChannel, channels: vi.fn(), channel: vi.fn() } }));
vi.mock('../../chat/state/overviewStore', () => ({ useOverviewStore: { getState: () => ({ refresh: async () => undefined }) } }));

function channel(id: string, extra: Partial<AdminChannelRow> = {}): AdminChannelRow {
  return {
    id,
    slug: id,
    name: `频道 ${id}`,
    description: null,
    audience: 'all',
    postPolicy: 'members',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastMessageAt: null,
    memberIds: [],
    historyVisibility: 'since_join',
    ...extra,
  };
}

describe('saveChannel', () => {
  afterEach(() => {
    updateChannel.mockReset();
    adminCache.clear();
  });

  it('makes an open channel custom with its list in exactly one PATCH', async () => {
    const open = channel('ch_a');
    adminCache.mutate(CHANNELS_KEY, () => [open]);
    const after = { ...open, audience: 'custom' as const, memberIds: ['a', 'b'] };
    updateChannel.mockResolvedValue({ channel: after });

    // 谁能看到 sends nothing for this choice; the picker's 完成 sends both fields together.
    // 「谁能看到」对这个选择不发送任何请求；由成员选择的「完成」一并发送两个字段。
    expect(audienceChoice(open, 'custom')).toBe('members');
    expect(updateChannel).not.toHaveBeenCalled();
    const saved = await saveChannel(open, memberPickerSave(open, ['a', 'b']).change);

    expect(updateChannel).toHaveBeenCalledTimes(1);
    expect(updateChannel).toHaveBeenCalledWith('ch_a', { audience: 'custom', memberIds: ['a', 'b'] });
    expect(saved).toEqual(after);
    expect(adminCache.read<AdminChannelRow[]>(CHANNELS_KEY).data).toEqual([after]);
  });

  it('sends nothing when nothing changed', async () => {
    const custom = channel('ch_b', { audience: 'custom', memberIds: ['a'] });
    expect(await saveChannel(custom, memberPickerSave(custom, ['a']).change)).toBe(custom);
    expect(updateChannel).not.toHaveBeenCalled();
  });
});
