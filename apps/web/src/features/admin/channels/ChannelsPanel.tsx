import { useState, type FormEvent } from 'react';
import { CHANNEL_AUDIENCES, CHANNEL_AUDIENCE_LABELS, POST_POLICIES, POST_POLICY_LABELS, type ChannelAudience, type PostPolicy } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { Button } from '../../../shared/ui/Button';
import { Card, Notice } from '../../../shared/ui/Card';
import { Field, Select, TextInput } from '../../../shared/ui/Field';
import { adminApi } from '../api';

export function ChannelsPanel() {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [audience, setAudience] = useState<ChannelAudience>('all');
  const [postPolicy, setPostPolicy] = useState<PostPolicy>('members');
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    setBusy(true);
    try {
      await adminApi.createChannel({ name, description: description || undefined, audience, postPolicy });
      setMessage({ tone: 'success', text: `频道「${name}」已创建` });
      setName('');
      setDescription('');
    } catch (err) {
      setMessage({ tone: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="mb-3 font-semibold">新建频道</h2>
      <form onSubmit={submit} className="space-y-3">
        <Field label="名称">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        </Field>
        <Field label="简介（选填）">
          <TextInput value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} />
        </Field>
        <Field label="谁能看到" hint={audience === 'custom' ? '创建后只有你在里面；指定成员的加入功能通过接口完成。' : undefined}>
          <Select value={audience} onChange={(e) => setAudience(e.target.value as ChannelAudience)}>
            {CHANNEL_AUDIENCES.map((a) => (
              <option key={a} value={a}>
                {CHANNEL_AUDIENCE_LABELS[a]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="谁能发言">
          <Select value={postPolicy} onChange={(e) => setPostPolicy(e.target.value as PostPolicy)}>
            {POST_POLICIES.map((p) => (
              <option key={p} value={p}>
                {POST_POLICY_LABELS[p]}
              </option>
            ))}
          </Select>
        </Field>
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
        <Button type="submit" block loading={busy} disabled={!name.trim()}>
          创建频道
        </Button>
      </form>
    </Card>
  );
}
