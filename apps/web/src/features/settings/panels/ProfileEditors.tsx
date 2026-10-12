import { useState, type FormEvent } from 'react';
import { ABOUT_MAX, HEADLINE_MAX, LOCATION_MAX, OPEN_TO, OPEN_TO_LABELS, SKILL_MAX_COUNT, SKILL_MAX_LENGTH, type MemberProfile, type MemberSelf, type OpenTo } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { Button } from '../../../shared/ui/Button';
import { Notice } from '../../../shared/ui/Card';
import { Field, TextArea, TextInput } from '../../../shared/ui/Field';
import { profileApi } from '../../profile/api';

export function IntroEditor({ member, onSaved }: { member: MemberProfile; onSaved: (member: MemberSelf) => void }) {
  const [headline, setHeadline] = useState(member.headline ?? '');
  const [location, setLocation] = useState(member.location ?? '');
  const [major, setMajor] = useState(member.major ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await profileApi.update({
        headline: headline.trim() || null,
        location: location.trim() || null,
        major: major.trim() || null,
      });
      onSaved(res.member);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <Field label="标题">
        <TextInput value={headline} maxLength={HEADLINE_MAX} placeholder="例如 UTM 计算机 · 在找暑期实习" onChange={(event) => setHeadline(event.target.value)} />
      </Field>
      <Field label="所在地">
        <TextInput value={location} maxLength={LOCATION_MAX} placeholder="多伦多" onChange={(event) => setLocation(event.target.value)} />
      </Field>
      <Field label="专业">
        <TextInput value={major} maxLength={80} placeholder="计算机科学" onChange={(event) => setMajor(event.target.value)} />
      </Field>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Button type="submit" block loading={busy}>
        保存
      </Button>
    </form>
  );
}

export function AboutEditor({ member, onSaved }: { member: MemberProfile; onSaved: (member: MemberSelf) => void }) {
  const [about, setAbout] = useState(member.about ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await profileApi.update({ about: about.trim() || null });
      onSaved(res.member);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <TextArea value={about} maxLength={ABOUT_MAX} placeholder="你在学什么、做过什么、想认识谁" onChange={(event) => setAbout(event.target.value)} />
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Button type="submit" block loading={busy}>
        保存
      </Button>
    </form>
  );
}

export function OpenToEditor({ member, onSaved }: { member: MemberProfile; onSaved: (member: MemberSelf) => void }) {
  const [openTo, setOpenTo] = useState<OpenTo[]>(member.openTo ?? []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function toggle(id: OpenTo) {
    setOpenTo((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await profileApi.update({ openTo });
      onSaved(res.member);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {OPEN_TO.map((id) => {
          const on = openTo.includes(id);
          return (
            <button key={id} type="button" onClick={() => toggle(id)} className={`min-h-11 rounded-lg px-3 text-[15px] ${on ? 'bg-brand-800 text-white' : 'bg-stone-100 text-stone-700'}`}>
              {OPEN_TO_LABELS[id]}
            </button>
          );
        })}
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Button type="submit" block loading={busy}>
        保存
      </Button>
    </form>
  );
}

export function SkillsEditor({ member, onChange }: { member: MemberProfile; onChange: (member: MemberSelf) => void }) {
  const [skills, setSkills] = useState<string[]>(member.skills ?? []);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function persist(next: string[]) {
    setBusy(true);
    setError(null);
    try {
      const res = await profileApi.update({ skills: next });
      setSkills(res.member.skills);
      onChange(res.member);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function add() {
    const skill = draft.trim();
    setDraft('');
    if (!skill || skills.includes(skill) || busy) return;
    if (skill.length > SKILL_MAX_LENGTH) {
      setError(`每项不超过 ${SKILL_MAX_LENGTH} 个字`);
      return;
    }
    if (skills.length >= SKILL_MAX_COUNT) {
      setError(`最多 ${SKILL_MAX_COUNT} 项`);
      return;
    }
    void persist([...skills, skill]);
  }

  return (
    <div className="space-y-3">
      {skills.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {skills.map((skill) => (
            <button key={skill} type="button" disabled={busy} onClick={() => void persist(skills.filter((item) => item !== skill))} className="min-h-11 rounded-lg bg-brand-50 px-3 text-[15px] text-brand-800">
              {skill} ×
            </button>
          ))}
        </div>
      ) : null}
      <div className="flex gap-2">
        <TextInput
          className="min-w-0 flex-1"
          value={draft}
          maxLength={SKILL_MAX_LENGTH}
          placeholder="Python、咨询"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add();
            }
          }}
        />
        <Button type="button" variant="secondary" onClick={add} loading={busy}>
          添加
        </Button>
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
    </div>
  );
}
