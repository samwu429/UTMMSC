import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  CHANNEL_AUDIENCES,
  CHANNEL_AUDIENCE_LABELS,
  POST_POLICIES,
  POST_POLICY_LABELS,
  type AdminChannelRow,
  type AdminMemberRow,
  type ChannelAudience,
  type PostPolicy,
} from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { useLabels, useTr } from '../../../shared/i18n/locale';
import { Button } from '../../../shared/ui/Button';
import { Card, EmptyState, Notice, Spinner } from '../../../shared/ui/Card';
import { useConfirm } from '../../../shared/ui/confirm';
import { Field, Select, TextInput } from '../../../shared/ui/Field';
import { adminApi } from '../api';

const AUDIENCE_EN: Record<ChannelAudience, string> = {
  all: 'All members',
  student: 'Students',
  alumni: 'Graduates',
  honorary: 'Honorary advisors',
  heads: 'Department heads',
  officers: 'Presidium',
  staff: 'Staff and above',
  custom: 'Selected members',
};

const POLICY_EN: Record<PostPolicy, string> = {
  members: 'Anyone can post',
  staff: 'Staff and above can post',
};

function emptyForm() {
  return {
    name: '',
    description: '',
    audience: 'all' as ChannelAudience,
    postPolicy: 'members' as PostPolicy,
    memberIds: [] as string[],
  };
}

export function ChannelsPanel() {
  const tr = useTr();
  const { role } = useLabels();
  const ask = useConfirm();
  const [channels, setChannels] = useState<AdminChannelRow[] | null>(null);
  const [members, setMembers] = useState<AdminMemberRow[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [memberQuery, setMemberQuery] = useState('');
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function load() {
    const [channelRes, memberRes] = await Promise.all([adminApi.channels(), adminApi.members()]);
    setChannels(channelRes.channels);
    setMembers(memberRes.members.filter((item) => item.status === 'active'));
  }

  useEffect(() => {
    load().catch((err) => setMessage({ tone: 'error', text: errorMessage(err) }));
  }, []);

  const filteredMembers = useMemo(() => {
    const q = memberQuery.trim().toLowerCase();
    const list = members ?? [];
    if (!q) return list;
    return list.filter(
      (item) => item.displayName.toLowerCase().includes(q) || item.email.toLowerCase().includes(q) || role(item.role).toLowerCase().includes(q),
    );
  }, [memberQuery, members, role]);

  function beginCreate() {
    setEditingId(null);
    setForm(emptyForm());
    setMemberQuery('');
    setMessage(null);
  }

  function beginEdit(channel: AdminChannelRow) {
    setEditingId(channel.id);
    setForm({
      name: channel.name,
      description: channel.description ?? '',
      audience: channel.audience,
      postPolicy: channel.postPolicy,
      memberIds: [...channel.memberIds],
    });
    setMemberQuery('');
    setMessage(null);
  }

  function toggleMember(id: string) {
    setForm((prev) => ({
      ...prev,
      memberIds: prev.memberIds.includes(id) ? prev.memberIds.filter((item) => item !== id) : [...prev.memberIds, id],
    }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    setBusy(true);
    try {
      const body = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        audience: form.audience,
        postPolicy: form.postPolicy,
        memberIds: form.audience === 'custom' ? form.memberIds : undefined,
      };
      if (editingId) {
        await adminApi.updateChannel(editingId, {
          ...body,
          description: form.description.trim() ? form.description.trim() : null,
          memberIds: form.audience === 'custom' ? form.memberIds : undefined,
        });
        setMessage({ tone: 'success', text: tr(`频道「${body.name}」已更新`, `Channel “${body.name}” updated`) });
      } else {
        await adminApi.createChannel(body);
        setMessage({ tone: 'success', text: tr(`频道「${body.name}」已创建`, `Channel “${body.name}” created`) });
      }
      beginCreate();
      await load();
    } catch (err) {
      setMessage({ tone: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function remove(channel: AdminChannelRow) {
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
      if (editingId === channel.id) beginCreate();
      setChannels((prev) => (prev ?? []).filter((item) => item.id !== channel.id));
      setMessage({ tone: 'success', text: tr(`频道「${channel.name}」已删除`, `Channel “${channel.name}” deleted`) });
    } catch (err) {
      setMessage({ tone: 'error', text: errorMessage(err) });
    } finally {
      setDeletingId(null);
    }
  }

  const formTitle = editingId ? tr('编辑频道', 'Edit channel') : tr('新建频道', 'New channel');

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
              <li key={channel.id} className="flex items-start gap-2 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-brand-800">{channel.name}</p>
                  <p className="mt-0.5 text-sm text-stone-500">
                    {tr(CHANNEL_AUDIENCE_LABELS[channel.audience], AUDIENCE_EN[channel.audience])}
                    <span className="mx-1">·</span>
                    {tr(POST_POLICY_LABELS[channel.postPolicy], POLICY_EN[channel.postPolicy])}
                    {channel.audience === 'custom' ? (
                      <>
                        <span className="mx-1">·</span>
                        {tr(`${channel.memberIds.length} 人`, `${channel.memberIds.length} people`)}
                      </>
                    ) : null}
                  </p>
                  {channel.description ? <p className="mt-1 text-sm text-stone-600">{channel.description}</p> : null}
                </div>
                <Button type="button" variant="secondary" className="shrink-0 py-2" onClick={() => beginEdit(channel)}>
                  {tr('编辑', 'Edit')}
                </Button>
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
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-semibold">{formTitle}</h2>
          {editingId ? (
            <button type="button" onClick={beginCreate} className="min-h-11 text-sm text-brand-800">
              {tr('改为新建', 'New instead')}
            </button>
          ) : null}
        </div>
        <form onSubmit={submit} className="space-y-3">
          <Field label={tr('名称', 'Name')}>
            <TextInput value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} maxLength={40} />
          </Field>
          <Field label={tr('简介（选填）', 'Description (optional)')}>
            <TextInput
              value={form.description}
              onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
              maxLength={200}
            />
          </Field>
          <Field
            label={tr('谁能看到', 'Who can see it')}
            hint={
              form.audience === 'custom'
                ? tr('只有勾选的成员能看到这个频道。能管理频道的人始终看得到。', 'Only the selected members can see this channel. People who manage channels always can.')
                : tr('按身份或分组开放。能管理频道的人始终看得到全部频道。', 'Open by enrollment or office group. People who manage channels always see every channel.')
            }
          >
            <Select
              value={form.audience}
              onChange={(e) => setForm((prev) => ({ ...prev, audience: e.target.value as ChannelAudience }))}
            >
              {CHANNEL_AUDIENCES.map((a) => (
                <option key={a} value={a}>
                  {tr(CHANNEL_AUDIENCE_LABELS[a], AUDIENCE_EN[a])}
                </option>
              ))}
            </Select>
          </Field>
          {form.audience === 'custom' ? (
            <Field label={tr('指定成员', 'Selected members')}>
              <TextInput
                value={memberQuery}
                onChange={(e) => setMemberQuery(e.target.value)}
                placeholder={tr('搜索姓名、邮箱或身份', 'Search name, email, or role')}
              />
              <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-stone-200">
                {members === null ? <div className="p-3"><Spinner /></div> : null}
                {members && filteredMembers.length === 0 ? (
                  <p className="px-3 py-2 text-sm text-stone-500">{tr('没有匹配的成员', 'No matching members')}</p>
                ) : null}
                {filteredMembers.map((item) => {
                  const on = form.memberIds.includes(item.id);
                  return (
                    <label key={item.id} className="flex min-h-11 cursor-pointer items-center gap-3 border-b border-stone-100 px-3 last:border-b-0">
                      <input type="checkbox" checked={on} onChange={() => toggleMember(item.id)} className="h-4 w-4 accent-brand-800" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] text-brand-800">{item.displayName}</span>
                        <span className="block truncate text-xs text-stone-500">
                          {role(item.role)} · {item.email}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
              <p className="mt-1 text-xs text-stone-500">{tr(`已选 ${form.memberIds.length} 人`, `${form.memberIds.length} selected`)}</p>
            </Field>
          ) : null}
          <Field label={tr('谁能发言', 'Who can post')}>
            <Select
              value={form.postPolicy}
              onChange={(e) => setForm((prev) => ({ ...prev, postPolicy: e.target.value as PostPolicy }))}
            >
              {POST_POLICIES.map((p) => (
                <option key={p} value={p}>
                  {tr(POST_POLICY_LABELS[p], POLICY_EN[p])}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" block loading={busy} disabled={!form.name.trim()}>
            {editingId ? tr('保存修改', 'Save changes') : tr('创建频道', 'Create channel')}
          </Button>
        </form>
      </Card>
    </div>
  );
}
