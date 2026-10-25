import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DEFAULT_HISTORY_VISIBILITY, channelRoomId, type AdminChannelRow, type HistoryVisibility } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { useLabels } from '../../../shared/i18n/locale';
import { toast } from '../../../shared/ui/toast';
import { ChannelIconEditor } from '../../chat/info/ChannelIconEditor';
import { ChannelIcon } from '../../chat/list/ChannelIcon';
import { roomLink } from '../../chat/list/conversations';
import { adminApi } from '../api';
import { AdminScreen, useAdminBack } from '../layout/AdminScreen';
import { plural } from '../sections';
import { refreshAdminSummary, useAdminSummary } from '../state/summaryStore';
import { AdminCell, AdminGroup } from '../ui/AdminCell';
import { useAdminConfirm } from '../ui/overlayGate';
import { TypedConfirmSheet } from '../ui/TypedConfirmSheet';
import { forgetChannel, refreshChatList, saveChannel, storeChannel, takeMemberPickerRequest } from './channelData';
import { audienceLabel, channelsPath, postPolicyLabel } from './channelForm';
import { HistoryGroup, useChannelPaths, useChannelScreen, useSettingsBack } from './channelParts';

function Header({ channel }: { channel: AdminChannelRow }) {
  const { tr } = useLabels();
  const audience = audienceLabel(channel.audience);
  const n = channel.memberIds.length;
  return (
    <AdminGroup>
      <div className="flex items-center gap-4 px-4 py-4">
        <ChannelIcon name={channel.name} iconKey={channel.iconKey} size={64} />
        <div className="min-w-0 flex-1">
          <p className="break-words text-[20px] font-semibold leading-7 text-wx-ink">{channel.name}</p>
          <p className="text-[14px] text-wx-meta">
            {channel.audience === 'custom' ? tr(`${n} 位成员`, plural(n, 'member', 'members')) : tr(`${audience.zh}可见`, `Visible to ${audience.en.toLowerCase()}`)}
          </p>
        </div>
      </div>
    </AdminGroup>
  );
}

/**
 * 频道设置, /admin/channels/:id, laid out like WeChat's 群管理: the icon, name and description; who can see it, its
 * members and who can post; the history switch; a way into the chat; and 删除频道 alone at the bottom. Each row opens
 * a focused editor. The switch saves at once and rolls back with a toast if the server refuses. Deleting asks for the
 * channel's name to be typed.
 * 「频道设置」，/admin/channels/:id，布局与微信「群管理」一致：图标、名称和简介；谁能看到、成员以及谁能发言；历史消息开关；进入聊天的入口；
 * 以及单独位于底部的「删除频道」。每一行打开一个专门的编辑界面。开关立即保存，服务器拒绝时回滚并提示。删除需要输入频道名称。
 */
export function ChannelSettings({ id }: { id: string }) {
  const { tr } = useLabels();
  const navigate = useNavigate();
  const goBack = useAdminBack();
  const confirm = useAdminConfirm();
  const { list, search } = useChannelPaths(id);
  // Opened from chat info, back returns there in one step.
  // 从聊天信息打开时，返回一步回到聊天信息。
  const back = useSettingsBack(id);
  const [deleting, setDeleting] = useState<'asking' | 'busy' | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const { channel, fallback } = useChannelScreen(id, deleting === 'busy');
  const ready = channel !== undefined;

  // A custom channel just created goes on to its member picker, once these settings are on screen.
  // 刚创建的指定成员频道在本设置界面显示之后接着打开成员选择。
  useEffect(() => {
    if (ready && takeMemberPickerRequest(id)) navigate(channelsPath(id, 'members', search));
  }, [ready, id, navigate, search]);

  if (!channel) {
    return (
      <AdminScreen title={tr('频道设置', 'Channel settings')} back={back} escapeTo={list}>
        {fallback}
      </AdminScreen>
    );
  }

  const current = channel;
  const audience = audienceLabel(current.audience);
  const policy = postPolicyLabel(current.postPolicy);
  const sub = (screen: Parameters<typeof channelsPath>[1]) => channelsPath(current.id, screen, search);
  const n = current.memberIds.length;

  async function setHistory(next: HistoryVisibility) {
    if (historyBusy) return;
    setHistoryBusy(true);
    // Shown at once; the server's answer replaces it, and a refusal puts the old value back.
    // 立即显示；服务器的结果会替换它，被拒绝时恢复原来的值。
    storeChannel({ ...current, historyVisibility: next });
    try {
      await saveChannel(current, { historyVisibility: next });
      toast(tr('已保存', 'Saved'));
    } catch (err) {
      storeChannel(current);
      toast(errorMessage(err));
    } finally {
      setHistoryBusy(false);
    }
  }

  async function remove() {
    // The sheet closes first, so its history entry is gone before the screen goes back to the list.
    // 先关闭确认层，在界面返回列表之前它的历史记录已被移除。
    setDeleting('busy');
    try {
      await adminApi.deleteChannel(current.id);
    } catch (err) {
      toast(errorMessage(err));
      setDeleting(null);
      return;
    }
    useAdminSummary.getState().adjust('channels', -1);
    forgetChannel(current.id);
    goBack(list);
    refreshAdminSummary();
    refreshChatList();
    toast(tr(`已删除「${current.name}」`, `Deleted "${current.name}"`));
  }

  return (
    <AdminScreen title={tr('频道设置', 'Channel settings')} back={back} escapeTo={list}>
      <Header channel={current} />
      <AdminGroup>
        {current.iconKey !== undefined ? (
          <ChannelIconEditor
            channelId={current.id}
            iconKey={current.iconKey ?? null}
            canManage
            name={current.name}
            ask={confirm}
            onChange={(_key, next) => storeChannel(next)}
          />
        ) : null}
        <AdminCell label={tr('频道名称', 'Channel name')} value={current.name} to={sub('name')} />
        <AdminCell label={tr('频道简介', 'Description')} value={current.description?.trim() ? current.description : tr('未填写', 'None')} to={sub('description')} />
      </AdminGroup>
      <AdminGroup>
        <AdminCell label={tr('谁能看到', 'Who can see it')} value={tr(audience.zh, audience.en)} to={sub('audience')} />
        {current.audience === 'custom' ? <AdminCell label={tr('成员', 'Members')} value={tr(`${n} 人`, plural(n, 'person', 'people'))} to={sub('members')} /> : null}
        <AdminCell label={tr('谁能发言', 'Who can post')} value={tr(policy.zh, policy.en)} to={sub('post')} />
      </AdminGroup>
      <HistoryGroup value={current.historyVisibility ?? DEFAULT_HISTORY_VISIBILITY} disabled={historyBusy} onChange={(next) => void setHistory(next)} />
      <AdminGroup>
        <AdminCell label={tr('打开频道', 'Open channel')} to={roomLink(channelRoomId(current.id))} />
      </AdminGroup>
      <AdminGroup>
        <AdminCell
          label={deleting === 'busy' ? tr('正在删除…', 'Deleting…') : tr('删除频道', 'Delete channel')}
          danger
          disabled={deleting === 'busy'}
          onClick={() => setDeleting('asking')}
        />
      </AdminGroup>
      {deleting === 'asking' ? (
        <TypedConfirmSheet
          title={tr(`删除「${current.name}」？`, `Delete "${current.name}"?`)}
          body={tr('频道会从所有人的聊天列表中消失，聊天记录无法找回。', "The channel disappears from everyone's chat list, and its history can't be recovered.")}
          expected={current.name}
          inputLabel={tr('输入频道名称以确认', 'Type the channel name to confirm')}
          confirmLabel={tr('删除频道', 'Delete channel')}
          onConfirm={() => void remove()}
          onCancel={() => setDeleting(null)}
        />
      ) : null}
    </AdminScreen>
  );
}
