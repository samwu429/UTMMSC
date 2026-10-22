import { useState, type FormEvent } from 'react';
import type { Experience } from '@utmmsc/shared';
import { errorMessage } from '../../shared/api/errors';
import { useTr } from '../../shared/i18n/locale';
import { Button } from '../../shared/ui/Button';
import { Notice } from '../../shared/ui/Card';
import { Field, TextArea, TextInput } from '../../shared/ui/Field';
import { profileApi } from './api';

export function ExperienceForm({ onCreated }: { onCreated: (experience: Experience) => void }) {
  const tr = useTr();
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
      setError(tr('请填写身份和机构', 'Enter a role and an organization.'));
      return;
    }
    if (!Number.isInteger(start) || startYear.trim() === '') {
      setError(tr('请填写开始年份', 'Enter a start year.'));
      return;
    }
    if (!current && (endYear.trim() === '' || !Number.isInteger(end))) {
      setError(tr('请填写结束年份，或勾选仍在进行', 'Enter an end year, or tick "Ongoing".'));
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
      <Field label={tr('身份', 'Role')}>
        <TextInput value={title} maxLength={40} placeholder={tr('研究助理、实习生', 'Research assistant, intern')} onChange={(event) => setTitle(event.target.value)} />
      </Field>
      <Field label={tr('机构', 'Organization')}>
        <TextInput value={organization} maxLength={60} placeholder={tr('多伦多大学、某公司', 'University of Toronto, a company')} onChange={(event) => setOrganization(event.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <div className={current ? 'col-span-2' : undefined}>
          <Field label={tr('开始年份', 'Start year')}>
            <TextInput inputMode="numeric" value={startYear} placeholder="2024" onChange={(event) => setStartYear(event.target.value)} />
          </Field>
        </div>
        {current ? null : (
          <Field label={tr('结束年份', 'End year')}>
            <TextInput inputMode="numeric" value={endYear} placeholder="2025" onChange={(event) => setEndYear(event.target.value)} />
          </Field>
        )}
      </div>
      <label className="flex min-h-11 items-center gap-2 text-[15px] text-stone-700">
        <input type="checkbox" checked={current} onChange={(event) => setCurrent(event.target.checked)} className="h-4 w-4 accent-brand-800" />
        {tr('仍在进行', 'Ongoing')}
      </label>
      <Field label={tr('说明', 'Description')}>
        <TextArea value={description} maxLength={300} placeholder={tr('可以不填', 'Optional')} onChange={(event) => setDescription(event.target.value)} />
      </Field>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Button type="submit" block loading={busy}>
        {tr('保存', 'Save')}
      </Button>
    </form>
  );
}
