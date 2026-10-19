import { useEffect, useState, type FormEvent } from 'react';
import {
  CHANNEL_AUDIENCES,
  CHANNEL_AUDIENCE_LABELS,
  POST_POLICIES,
  POST_POLICY_LABELS,
  type ChannelAudience,
  type PostPolicy,
} from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { useTr } from '../../../shared/i18n/locale';
import { Button } from '../../../shared/ui/Button';
import { Card, EmptyState, Notice, Spinner } from '../../../shared/ui/Card';
import { useConfirm } from '../../../shared/ui/confirm';
import { Field, Select, TextInput } from '../../../shared/ui/Field';
import { adminApi } from '../api';

interface ChannelRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  audience: ChannelAudience;
  postPolicy: PostPolicy;
  createdAt: string;
  lastMessageAt: string | null;
}

const AUDIENCE_EN: Record<ChannelAudience, string> = {
  all: 'All members',
  student: 'Students',
  alumni: 'Graduates',
  custom: 'Selected members',
};

const POLICY_EN: Record<PostPolicy, string> = {
  members: 'Anyone can post',
  staff: 'Staff and above can post',
};

export function ChannelsPanel() {
  const tr = useTr();
  const ask = useConfirm();
  const [channels, setChannels] = useState<ChannelRow[] | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [audience, setAudience] = useState<ChannelAudience>('all');
  const [postPolicy, setPostPolicy] = useState<PostPolicy>('members');
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function load() {
    const res = await adminApi.channels();
    setChannels(res.channels);
  }

  useEffect(() => {
    load().catch((err) => setMessage({ tone: 'error', text: errorMessage(err) }));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    setBusy(true);
    try {
      await adminApi.createChannel({ name, description: description || undefined, audience, postPolicy });
      setMessage({ tone: 'success', text: tr(`频道「${name}」已创建`, `Channel “${name}” created`) });
      setName('');
      setDescription('');
      await load();
    } catch (err) {
      setMessage({ tone: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function remove(channel: ChannelRow) {
    const ok = await ask({
      title: tr('删除这个频道？', 'Delete this channel?'),
      body: tr(`删除后，「${channel.name}」会从成员的聊天列表里消失。`, `“${channel.name}” will disappear from everyone’s chat list.`),
      confirmLabel: tr('删除', 'Delete'),
      danger: true,
    });
    if (!ok) return;
    setDeletingId(channel.id);
    setMessage(null);
    try {
      await adminApi.deleteChannel(channel.id);
      setChannels((prev) => (prev ?? []).filter((item) => item.id !== channel.id));
      setMessage({ tone: 'success', text: tr(`频道「${channel.name}」已删除`, `Channel “${channel.name}” deleted`) });
    } catch (err) {
      setMessage({ tone: 'error', text: errorMessage(err) });
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-3">
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <Card>
        <h2 className="mb-3 font-semibold">{tr('现有频道', 'Channels')}</h2>
        {channels === null ? <Spinner /> : null}
        {channels && channels.length === 0 ? <EmptyState>{tr('还没有频道', 'No channels yet')}</EmptyState> : null}
        {channels && channels.length > 0 ? (
          <ul className="divide-y divide-stone-200">
            {channels.map((channel) => (
              <li key={channel.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-brand-800">{channel.name}</p>
                  <p className="mt-0.5 text-sm text-stone-500">
                    {tr(CHANNEL_AUDIENCE_LABELS[channel.audience], AUDIENCE_EN[channel.audience])}
                    <span className="mx-1">·</span>
                    {tr(POST_POLICY_LABELS[channel.postPolicy], POLICY_EN[channel.postPolicy])}
                  </p>
                  {channel.description ? <p className="mt-1 text-sm text-stone-600">{channel.description}</p> : null}
                </div>
                <Button
                  type="button"
                  variant="danger"
                  className="shrink-0 py-2"
                  loading={deletingId === channel.id}
                  disabled={deletingId !== null && deletingId !== channel.id}
                  onClick={() => void remove(channel)}
                >
                  {tr('删除', 'Delete')}
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      <Card>
        <h2 className="mb-3 font-semibold">{tr('新建频道', 'New channel')}</h2>
        <form onSubmit={submit} className="space-y-3">
          <Field label={tr('名称', 'Name')}>
            <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
          </Field>
          <Field label={tr('简介（选填）', 'Description (optional)')}>
            <TextInput value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} />
          </Field>
          <Field
            label={tr('谁能看到', 'Who can see it')}
            hint={audience === 'custom' ? tr('创建后只有你在里面；指定成员的加入功能通过接口完成。', 'After you create it, only you are inside. Adding other members is done through the API.') : undefined}
          >
            <Select value={audience} onChange={(e) => setAudience(e.target.value as ChannelAudience)}>
              {CHANNEL_AUDIENCES.map((a) => (
                <option key={a} value={a}>
                  {tr(CHANNEL_AUDIENCE_LABELS[a], AUDIENCE_EN[a])}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={tr('谁能发言', 'Who can post')}>
            <Select value={postPolicy} onChange={(e) => setPostPolicy(e.target.value as PostPolicy)}>
              {POST_POLICIES.map((p) => (
                <option key={p} value={p}>
                  {tr(POST_POLICY_LABELS[p], POLICY_EN[p])}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" block loading={busy} disabled={!name.trim()}>
            {tr('创建频道', 'Create channel')}
          </Button>
        </form>
      </Card>
    </div>
  );
}
