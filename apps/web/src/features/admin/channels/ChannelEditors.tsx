import { useEffect, useId, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ChannelAudience, PostPolicy } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { useLabels } from '../../../shared/i18n/locale';
import { toast } from '../../../shared/ui/toast';
import { AdminScreen, useAdminBack } from '../layout/AdminScreen';
import { useInsetGroups } from '../layout/media';
import { AdminGroup } from '../ui/AdminCell';
import { useAdminConfirm } from '../ui/overlayGate';
import { RadioList } from '../ui/RadioList';
import { saveChannel } from './channelData';
import {
  AUDIENCE_DETAILS,
  AUDIENCE_ORDER,
  CHANNEL_DESCRIPTION_MAX,
  CHANNEL_NAME_MAX,
  POST_POLICY_DETAILS,
  POST_POLICY_ORDER,
  audienceChoice,
  audienceLabel,
  channelPatch,
  channelsPath,
  isEmptyPatch,
  isNarrowing,
  isValidChannelName,
  postPolicyLabel,
} from './channelForm';
import { Counter, HEADER_ACTION, useChannelPaths, useChannelScreen } from './channelParts';

type TextField = 'name' | 'description';

/**
 * 频道名称 and 频道简介: one field, 保存 at the top right once something changed, and a counter (40 and 200, counted as
 * the server counts). Saving goes back to the settings.
 * 「频道名称」和「频道简介」：一个输入框，有改动后右上角的「保存」才可用，并带计数（40 和 200，与服务器的计数方式一致）。保存后返回设置。
 */
export function ChannelTextEditor({ id, field }: { id: string; field: TextField }) {
  const { tr } = useLabels();
  const goBack = useAdminBack();
  const insetGroups = useInsetGroups();
  const { settings, settingsBack } = useChannelPaths(id);
  const { channel, fallback } = useChannelScreen(id);
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputId = useId();
  const counterId = useId();
  const isName = field === 'name';
  const title = isName ? tr('频道名称', 'Channel name') : tr('频道简介', 'Description');
  const max = isName ? CHANNEL_NAME_MAX : CHANNEL_DESCRIPTION_MAX;

  const value = text ?? (channel ? (isName ? channel.name : (channel.description ?? '')) : '');
  const changed = channel ? !isEmptyPatch(channelPatch(channel, { [field]: value })) : false;
  const valid = isName ? isValidChannelName(value) : value.length <= max;
  const ready = channel !== undefined;

  // AdminScreen moves focus to its heading after a forward step, later than an autoFocus would; this runs after that,
  // so the one field takes focus back.
  // AdminScreen 在前进之后把焦点移到标题，晚于 autoFocus 生效；这里在其之后运行，因此由唯一的输入框重新获得焦点。
  useEffect(() => {
    if (ready) document.getElementById(inputId)?.focus({ preventScroll: true });
  }, [ready, inputId]);

  async function save(event?: FormEvent) {
    event?.preventDefault();
    if (!channel || !changed || !valid || busy) return;
    setBusy(true);
    try {
      await saveChannel(channel, { [field]: value });
      toast(tr('已保存', 'Saved'));
      goBack(settings);
    } catch (err) {
      toast(errorMessage(err));
      setBusy(false);
    }
  }

  const trailing = channel ? (
    <button type="button" onClick={() => void save()} disabled={!changed || !valid || busy} className={HEADER_ACTION}>
      {busy ? tr('保存中…', 'Saving…') : tr('保存', 'Save')}
    </button>
  ) : null;

  return (
    <AdminScreen title={title} back={settingsBack} escapeTo={settings} trailing={trailing}>
      {channel ? (
        <form onSubmit={(event) => void save(event)}>
          <AdminGroup>
            <div className="px-4 py-3">
              <label htmlFor={inputId} className="sr-only">
                {title}
              </label>
              {isName ? (
                <input
                  id={inputId}
                  value={value}
                  onChange={(event) => setText(event.target.value)}
                  maxLength={max}
                  autoComplete="off"
                  enterKeyHint="done"
                  aria-describedby={counterId}
                  className="w-full bg-transparent py-1.5 text-[17px] text-wx-ink outline-none"
                />
              ) : (
                <textarea
                  id={inputId}
                  value={value}
                  onChange={(event) => setText(event.target.value)}
                  maxLength={max}
                  rows={4}
                  aria-describedby={counterId}
                  placeholder={tr('说明这个频道是做什么的', 'Say what this channel is for')}
                  className="block min-h-[6.5rem] w-full resize-none bg-transparent py-1.5 text-[16px] leading-6 text-wx-ink outline-none placeholder:text-stone-400"
                />
              )}
              <div className="flex justify-end pt-1">
                <Counter id={counterId} value={value} max={max} />
              </div>
            </div>
          </AdminGroup>
          <p className={`pt-2 text-[13px] leading-relaxed text-wx-meta ${insetGroups ? 'px-1' : 'px-4'}`}>
            {isName
              ? tr('成员在聊天列表和频道里看到这个名称。', 'Members see this name in the chat list and in the channel.')
              : tr('显示在频道的聊天信息里。可以留空。', "Shown in the channel's chat info. It can be left empty.")}
          </p>
        </form>
      ) : (
        fallback
      )}
    </AdminScreen>
  );
}

/**
 * 谁能看到: every audience with one line saying who that is. A choice that can take the channel away from someone
 * asks first; one that only widens it saves at once. 指定成员 for a channel that is not custom yet saves nothing here
 * and goes on to the member picker, which saves the audience and the list together.
 * 「谁能看到」：每种受众各带一行说明是哪些人。可能让人失去访问权限的选择会先询问；只放宽范围的选择立即保存。尚不是指定成员的频道选择「指定成员」时，
 * 这里不保存，而是进入成员选择，由它一并保存受众和名单。
 */
export function AudiencePicker({ id }: { id: string }) {
  const { tr } = useLabels();
  const navigate = useNavigate();
  const goBack = useAdminBack();
  const confirm = useAdminConfirm();
  const { settings, settingsBack, search } = useChannelPaths(id);
  const { channel, fallback } = useChannelScreen(id);
  const [busy, setBusy] = useState<ChannelAudience | null>(null);

  async function pick(next: ChannelAudience) {
    if (!channel || busy) return;
    if (audienceChoice(channel, next) === 'members') {
      // The channel becomes custom only when the picker saves, in one request with its list; it asks there.
      // 频道只在成员选择保存时改为指定成员，与名单在同一次请求中发送；确认也在那里询问。
      navigate(channelsPath(channel.id, 'members', search), { replace: true });
      return;
    }
    if (isNarrowing(channel.audience, next)) {
      const label = audienceLabel(next);
      const ok = await confirm({
        title: tr(`改为${label.zh}？`, `Change to ${label.en}?`),
        body: tr('不在新范围内的成员会立刻看不到这个频道。', 'Members outside the new audience lose access right away.'),
        confirmLabel: tr('改为', 'Change'),
      });
      if (!ok) return;
    }
    setBusy(next);
    try {
      await saveChannel(channel, { audience: next });
    } catch (err) {
      toast(errorMessage(err));
      setBusy(null);
      return;
    }
    toast(tr('已保存', 'Saved'));
    goBack(settings);
  }

  return (
    <AdminScreen title={tr('谁能看到', 'Who can see it')} back={settingsBack} escapeTo={settings}>
      {channel ? (
        <RadioList<ChannelAudience>
          label={tr('谁能看到', 'Who can see it')}
          value={channel.audience}
          busy={busy}
          onSelect={(next) => void pick(next)}
          footer={tr('能管理频道的人始终看得到全部频道。', 'People who manage channels always see every channel.')}
          items={AUDIENCE_ORDER.map((audience) => {
            const label = audienceLabel(audience);
            const detail = AUDIENCE_DETAILS[audience];
            return { value: audience, label: tr(label.zh, label.en), detail: tr(detail.zh, detail.en) };
          })}
        />
      ) : (
        fallback
      )}
    </AdminScreen>
  );
}

/** 谁能发言: everyone who can see it, or staff and above only. Saves at once. */
/** 「谁能发言」：能看到的人都可以，或只有负责人及以上。立即保存。 */
export function PostPolicyPicker({ id }: { id: string }) {
  const { tr } = useLabels();
  const goBack = useAdminBack();
  const { settings, settingsBack } = useChannelPaths(id);
  const { channel, fallback } = useChannelScreen(id);
  const [busy, setBusy] = useState<PostPolicy | null>(null);

  async function pick(next: PostPolicy) {
    if (!channel || busy) return;
    setBusy(next);
    try {
      await saveChannel(channel, { postPolicy: next });
      toast(tr('已保存', 'Saved'));
      goBack(settings);
    } catch (err) {
      toast(errorMessage(err));
      setBusy(null);
    }
  }

  return (
    <AdminScreen title={tr('谁能发言', 'Who can post')} back={settingsBack} escapeTo={settings}>
      {channel ? (
        <RadioList<PostPolicy>
          label={tr('谁能发言', 'Who can post')}
          value={channel.postPolicy}
          busy={busy}
          onSelect={(next) => void pick(next)}
          footer={tr('负责人及以上指部长、主席团和系统管理员。', 'Staff and above means department heads, the presidium and system administrators.')}
          items={POST_POLICY_ORDER.map((policy) => {
            const label = postPolicyLabel(policy);
            const detail = POST_POLICY_DETAILS[policy];
            return { value: policy, label: tr(label.zh, label.en), detail: tr(detail.zh, detail.en) };
          })}
        />
      ) : (
        fallback
      )}
    </AdminScreen>
  );
}
