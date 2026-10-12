import { useState, type FormEvent } from 'react';
import type { Experience } from '@utmmsc/shared';
import { errorMessage } from '../../shared/api/errors';
import { Button } from '../../shared/ui/Button';
import { Notice } from '../../shared/ui/Card';
import { Field, TextArea, TextInput } from '../../shared/ui/Field';
import { profileApi } from './api';

export function ExperienceForm({ onCreated }: { onCreated: (experience: Experience) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [organization, setOrganization] = useState('');
  const [startYear, setStartYear] = useState('');
  const [endYear, setEndYear] = useState('');
  const [current, setCurrent] = useState(false);
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setTitle('');
    setOrganization('');
    setStartYear('');
    setEndYear('');
    setCurrent(false);
    setDescription('');
    setError(null);
    setOpen(false);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
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
      reset();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-sm font-medium text-brand-800">
        添加经历
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-3 rounded-xl bg-white p-4 ring-1 ring-stone-200">
      <Field label="身份">
        <TextInput value={title} maxLength={40} placeholder="研究助理、社团主席、实习生" onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="机构或团队">
        <TextInput value={organization} maxLength={60} placeholder="多伦多大学、某实验室、某公司" onChange={(e) => setOrganization(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <div className={current ? 'col-span-2' : undefined}>
          <Field label="开始年份">
            <TextInput inputMode="numeric" value={startYear} placeholder="2024" onChange={(e) => setStartYear(e.target.value)} />
          </Field>
        </div>
        {current ? null : (
          <Field label="结束年份">
            <TextInput inputMode="numeric" value={endYear} placeholder="2025" onChange={(e) => setEndYear(e.target.value)} />
          </Field>
        )}
      </div>
      <label className="flex items-center gap-2 text-sm text-stone-700">
        <input type="checkbox" checked={current} onChange={(e) => setCurrent(e.target.checked)} className="h-4 w-4 accent-brand-800" />
        仍在进行
      </label>
      <Field label="补充说明">
        <TextArea value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} placeholder="可以不填" />
      </Field>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <div className="flex gap-2">
        <Button type="submit" loading={busy}>
          保存经历
        </Button>
        <Button type="button" variant="secondary" onClick={reset}>
          取消
        </Button>
      </div>
    </form>
  );
}
