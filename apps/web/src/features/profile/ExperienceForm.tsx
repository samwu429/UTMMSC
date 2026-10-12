import { useState, type FormEvent } from 'react';
import type { Experience } from '@utmmsc/shared';
import { errorMessage } from '../../shared/api/errors';
import { Button } from '../../shared/ui/Button';
import { Notice } from '../../shared/ui/Card';
import { Field, TextArea, TextInput } from '../../shared/ui/Field';
import { profileApi } from './api';

export function ExperienceForm({ onCreated }: { onCreated: (experience: Experience) => void }) {
  const [title, setTitle] = useState('');
  const [organization, setOrganization] = useState('');
  const [startYear, setStartYear] = useState('');
  const [endYear, setEndYear] = useState('');
  const [current, setCurrent] = useState(true);
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const start = Number(startYear);
    const end = Number(endYear);
    if (!title.trim() || !organization.trim()) {
      setError('请填写身份和机构');
      return;
    }
    if (!Number.isInteger(start) || startYear.trim() === '') {
      setError('请填写开始年份');
      return;
    }
    if (!current && (endYear.trim() === '' || !Number.isInteger(end))) {
      setError('请填写结束年份，或勾选仍在进行');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await profileApi.addExperience({
        title: title.trim(),
        organization: organization.trim(),
        startYear: start,
        endYear: current ? null : end,
        current,
        description: description.trim() || null,
      });
      onCreated(res.experience);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="身份">
        <TextInput value={title} maxLength={40} placeholder="研究助理、实习生" onChange={(event) => setTitle(event.target.value)} />
      </Field>
      <Field label="机构">
        <TextInput value={organization} maxLength={60} placeholder="多伦多大学、某公司" onChange={(event) => setOrganization(event.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <div className={current ? 'col-span-2' : undefined}>
          <Field label="开始年份">
            <TextInput inputMode="numeric" value={startYear} placeholder="2024" onChange={(event) => setStartYear(event.target.value)} />
          </Field>
        </div>
        {current ? null : (
          <Field label="结束年份">
            <TextInput inputMode="numeric" value={endYear} placeholder="2025" onChange={(event) => setEndYear(event.target.value)} />
          </Field>
        )}
      </div>
      <label className="flex min-h-11 items-center gap-2 text-[15px] text-stone-700">
        <input type="checkbox" checked={current} onChange={(event) => setCurrent(event.target.checked)} className="h-4 w-4 accent-brand-800" />
        仍在进行
      </label>
      <Field label="说明">
        <TextArea value={description} maxLength={300} placeholder="可以不填" onChange={(event) => setDescription(event.target.value)} />
      </Field>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Button type="submit" block loading={busy}>
        保存
      </Button>
    </form>
  );
}
