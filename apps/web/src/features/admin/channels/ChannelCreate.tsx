import { useEffect, useId, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { CHANNEL_ICON_PRESETS, channelIconPresetKey, type AdminChannelRow, type ChannelAudience, type ChannelIconPresetId, type PostPolicy } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { useLabels } from '../../../shared/i18n/locale';
import type { SquareIconFiles } from '../../../shared/media/encodeSquareIcon';
import { Button } from '../../../shared/ui/Button';
import { toast } from '../../../shared/ui/toast';
import { useChannelIconChooser } from '../../chat/info/ChannelIconEditor';
import { applyIconResponse, channelIconApi } from '../../chat/info/channelIconApi';
import { ChannelIcon } from '../../chat/list/ChannelIcon';
import { adminApi } from '../api';
import { AdminScreen } from '../layout/AdminScreen';
import { useInsetGroups } from '../layout/media';
import { refreshAdminSummary, useAdminSummary } from '../state/summaryStore';
import { AdminGroup } from '../ui/AdminCell';
import { AdminIcon } from '../ui/icons';
import { RadioList } from '../ui/RadioList';
import { StickyActionBar } from '../ui/StickyActionBar';
import { refreshChatList, requestMemberPicker, storeChannel } from './channelData';
import {
  AUDIENCE_DETAILS,
  AUDIENCE_ORDER,
  CHANNEL_DESCRIPTION_MAX,
  CHANNEL_NAME_MAX,
  POST_POLICY_DETAILS,
  POST_POLICY_ORDER,
  audienceLabel,
  channelsPath,
  createChannelBody,
  emptyChannelDraft,
  isValidChannelName,
  postPolicyLabel,
  type ChannelDraft,
} from './channelForm';
import { Counter, HistoryGroup, useChannelPaths } from './channelParts';

/** The icon picked before the channel exists: uploaded right after POST /channels returns the id. */
/** 频道创建之前选好的图标：在 POST /channels 返回 id 之后立即上传。 */
type IconDraft = { kind: 'upload'; files: SquareIconFiles; url: string } | { kind: 'preset'; id: ChannelIconPresetId };

function IconPreview({ icon, name }: { icon: IconDraft | null; name: string }) {
  if (icon?.kind === 'upload') {
    return <img src={icon.url} alt="" width={40} height={40} draggable={false} className="h-10 w-10 shrink-0 rounded-[4px] object-cover" />;
  }
  return <ChannelIcon name={name} iconKey={icon?.kind === 'preset' ? channelIconPresetKey(icon.id) : null} size={40} />;
}

/**
 * 新建频道, /admin/channels/new: an optional icon, the name, an optional description, who can see it and who can post
 * as inline choices, and the history switch, with 创建 at the bottom. The channel's settings open next with 已创建; a
 * custom channel goes straight on to its member picker. An icon that fails to save leaves the channel created and
 * says so.
 * 「新建频道」，/admin/channels/new：可选的图标、名称、可选的简介、以内嵌选项呈现的谁能看到和谁能发言，以及历史消息开关，底部为「创建」。
 * 之后打开该频道的设置并提示「已创建」；指定成员频道直接进入成员选择。图标保存失败时频道仍已创建，并会说明。
 */
export function ChannelCreate() {
  const { tr } = useLabels();
  const navigate = useNavigate();
  const insetGroups = useInsetGroups();
  const { list, listBack, search } = useChannelPaths('');
  const [draft, setDraft] = useState<ChannelDraft>(emptyChannelDraft);
  const [icon, setIcon] = useState<IconDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const nameId = useId();
  const nameCounterId = useId();
  const descriptionId = useId();
  const descriptionCounterId = useId();

  // An uploaded draft's preview address is released when it is replaced or the form closes.
  // 上传草稿的预览地址在被替换或表单关闭时释放。
  useEffect(() => {
    if (icon?.kind !== 'upload') return;
    const url = icon.url;
    return () => URL.revokeObjectURL(url);
  }, [icon]);

  const chooser = useChannelIconChooser({
    hasIcon: icon !== null,
    selectedPreset: icon?.kind === 'preset' ? icon.id : null,
    onFiles: async (files) => setIcon({ kind: 'upload', files, url: URL.createObjectURL(files.icon) }),
    onPreset: async (id) => setIcon({ kind: 'preset', id }),
    onClear: () => setIcon(null),
    waitingLabel: tr('正在处理…', 'Processing…'),
  });

  const valid = isValidChannelName(draft.name) && draft.description.length <= CHANNEL_DESCRIPTION_MAX;
  const change = (patch: Partial<ChannelDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setProblem(null);
  };

  async function saveIcon(channel: AdminChannelRow): Promise<string | null> {
    if (!icon) return null;
    try {
      const res = icon.kind === 'upload' ? await channelIconApi.upload(channel.id, icon.files) : await channelIconApi.preset(channel.id, icon.id);
      applyIconResponse(res);
      storeChannel(res.channel);
      return null;
    } catch (err) {
      return errorMessage(err);
    }
  }

  async function create(event?: FormEvent) {
    event?.preventDefault();
    if (busy || !valid) return;
    setBusy(true);
    setProblem(null);
    let channel: AdminChannelRow;
    try {
      channel = (await adminApi.createChannel(createChannelBody(draft))).channel;
    } catch (err) {
      setProblem(errorMessage(err));
      setBusy(false);
      return;
    }
    storeChannel(channel);
    useAdminSummary.getState().adjust('channels', 1);
    refreshAdminSummary();
    refreshChatList();
    const iconProblem = await saveIcon(channel);
    toast(iconProblem ? tr(`频道已创建，但图标没有保存：${iconProblem}`, `The channel was created, but the icon wasn't saved: ${iconProblem}`) : tr('已创建', 'Created'));
    if (channel.audience === 'custom') requestMemberPicker(channel.id);
    navigate(channelsPath(channel.id, null, search), { replace: true });
  }

  const presetName = icon?.kind === 'preset' ? CHANNEL_ICON_PRESETS.find((preset) => preset.id === icon.id) : undefined;
  const iconValue = presetName ? tr(presetName.zh, presetName.en) : icon ? tr('已选图片', 'Image picked') : tr('文字头像', 'Text tile');
  const note = insetGroups ? 'px-1' : 'px-4';

  return (
    <AdminScreen
      title={tr('新建频道', 'New channel')}
      back={listBack}
      escapeTo={list}
      footer={
        <StickyActionBar>
          <Button onClick={() => void create()} loading={busy} disabled={!valid}>
            {tr('创建', 'Create')}
          </Button>
        </StickyActionBar>
      }
    >
      <form onSubmit={(event) => void create(event)}>
        <AdminGroup title={tr('图标（选填）', 'Icon (optional)')}>
          <button type="button" onClick={chooser.open} aria-haspopup="dialog" className="block w-full text-left outline-offset-[-2px] active:bg-wx-pressed">
            <span className="flex min-h-16 items-center gap-3 px-4 py-2.5">
              <IconPreview icon={icon} name={draft.name.trim()} />
              <span className="min-w-0 flex-1 truncate text-[17px] leading-6 text-wx-ink">{icon ? tr('更换图标', 'Change icon') : tr('选择图标', 'Choose an icon')}</span>
              <span className="shrink-0 text-[15px] text-wx-meta">{iconValue}</span>
              <AdminIcon name="chevron" className="h-4 w-4 shrink-0 text-stone-400" strokeWidth={2} />
            </span>
          </button>
        </AdminGroup>

        <AdminGroup title={<label htmlFor={nameId}>{tr('名称', 'Name')}</label>}>
          <div className="flex items-center gap-3 px-4 py-2">
            <input
              id={nameId}
              value={draft.name}
              onChange={(event) => change({ name: event.target.value })}
              maxLength={CHANNEL_NAME_MAX}
              autoComplete="off"
              enterKeyHint="next"
              aria-describedby={nameCounterId}
              placeholder={tr('例如：学术交流', 'For example: Academic')}
              className="min-w-0 flex-1 bg-transparent py-2 text-[17px] text-wx-ink outline-none placeholder:text-stone-400"
            />
            <Counter id={nameCounterId} value={draft.name} max={CHANNEL_NAME_MAX} />
          </div>
        </AdminGroup>

        <AdminGroup title={<label htmlFor={descriptionId}>{tr('简介（选填）', 'Description (optional)')}</label>}>
          <div className="px-4 py-2">
            <textarea
              id={descriptionId}
              value={draft.description}
              onChange={(event) => change({ description: event.target.value })}
              maxLength={CHANNEL_DESCRIPTION_MAX}
              rows={3}
              aria-describedby={descriptionCounterId}
              placeholder={tr('说明这个频道是做什么的', 'Say what this channel is for')}
              className="block min-h-[5rem] w-full resize-none bg-transparent py-1.5 text-[16px] leading-6 text-wx-ink outline-none placeholder:text-stone-400"
            />
            <div className="flex justify-end pb-1">
              <Counter id={descriptionCounterId} value={draft.description} max={CHANNEL_DESCRIPTION_MAX} />
            </div>
          </div>
        </AdminGroup>

        <RadioList<ChannelAudience>
          title={tr('谁能看到', 'Who can see it')}
          label={tr('谁能看到', 'Who can see it')}
          value={draft.audience}
          onSelect={(audience) => change({ audience })}
          footer={
            draft.audience === 'custom'
              ? tr('创建之后选择成员。能管理频道的人始终看得到全部频道。', 'You pick the members after creating it. People who manage channels always see every channel.')
              : tr('能管理频道的人始终看得到全部频道。', 'People who manage channels always see every channel.')
          }
          items={AUDIENCE_ORDER.map((audience) => {
            const label = audienceLabel(audience);
            const detail = AUDIENCE_DETAILS[audience];
            return { value: audience, label: tr(label.zh, label.en), detail: tr(detail.zh, detail.en) };
          })}
        />

        <RadioList<PostPolicy>
          title={tr('谁能发言', 'Who can post')}
          label={tr('谁能发言', 'Who can post')}
          value={draft.postPolicy}
          onSelect={(postPolicy) => change({ postPolicy })}
          items={POST_POLICY_ORDER.map((policy) => {
            const label = postPolicyLabel(policy);
            const detail = POST_POLICY_DETAILS[policy];
            return { value: policy, label: tr(label.zh, label.en), detail: tr(detail.zh, detail.en) };
          })}
        />

        <HistoryGroup value={draft.historyVisibility} onChange={(historyVisibility) => change({ historyVisibility })} />

        {problem ? (
          <p role="alert" className={`mt-3 rounded-lg bg-red-50 py-2 text-[14px] text-red-800 ${insetGroups ? 'px-3' : 'mx-4 px-3'}`}>
            {problem}
          </p>
        ) : null}
        <p className={`pt-3 text-[13px] leading-relaxed text-wx-meta ${note}`}>
          {tr('创建后频道立即出现在可见成员的聊天列表里。', 'Once created, the channel shows up in the chat list of everyone who can see it.')}
        </p>
      </form>
      {chooser.elements}
    </AdminScreen>
  );
}
