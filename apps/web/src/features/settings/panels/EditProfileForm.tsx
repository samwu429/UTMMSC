import { useState, type FormEvent } from 'react';
import { OPEN_TO, OPEN_TO_LABELS, SKILL_MAX_COUNT, SKILL_MAX_LENGTH, type MemberProfile, type MemberSelf, type OpenTo } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { Button } from '../../../shared/ui/Button';
import { Notice } from '../../../shared/ui/Card';
import { Field, TextArea, TextInput } from '../../../shared/ui/Field';
import { profileApi } from '../../profile/api';

export function EditProfileForm({ member, onCancel, onSaved }: { member: MemberProfile; onCancel: () => void; onSaved: (member: MemberSelf) => void }) {
  const [headline, setHeadline] = useState(member.headline ?? '');
  const [location, setLocation] = useState(member.location ?? '');
  const [major, setMajor] = useState(member.major ?? '');
  const [about, setAbout] = useState(member.about ?? '');
  const [skills, setSkills] = useState<string[]>(member.skills ?? []);
  const [skillDraft, setSkillDraft] = useState('');
  const [openTo, setOpenTo] = useState<OpenTo[]>(member.openTo ?? []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function addSkill() {
    const skill = skillDraft.trim();
    setSkillDraft('');
    if (!skill) return;
    if (skill.length > SKILL_MAX_LENGTH) {
      setError(`每项技能不超过 ${SKILL_MAX_LENGTH} 个字`);
      return;
    }
    if (skills.includes(skill)) return;
    if (skills.length >= SKILL_MAX_COUNT) {
      setError(`技能最多 ${SKILL_MAX_COUNT} 项`);
      return;
    }
    setError(null);
    setSkills((prev) => [...prev, skill]);
  }

  function toggleOpenTo(id: OpenTo) {
    setOpenTo((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await profileApi.update({
        headline: headline.trim() || null,
        location: location.trim() || null,
        major: major.trim() || null,
        about: about.trim() || null,
        skills,
        openTo,
      });
      onSaved(res.member);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-4 rounded-xl bg-white p-4 ring-1 ring-stone-200">
      <Field label="一句话介绍" hint="例如「UTM 计算机 · 在找 2027 暑期实习」">
        <TextInput value={headline} maxLength={80} onChange={(e) => setHeadline(e.target.value)} />
      </Field>
      <Field label="所在地" hint="例如多伦多、密西沙加">
        <TextInput value={location} maxLength={40} onChange={(e) => setLocation(e.target.value)} />
      </Field>
      <Field label="专业">
        <TextInput value={major} maxLength={80} onChange={(e) => setMajor(e.target.value)} />
      </Field>
      <Field label="简介">
        <TextArea value={about} maxLength={800} onChange={(e) => setAbout(e.target.value)} placeholder="你在学什么、做过什么、想认识谁" />
      </Field>
      <div>
        <p className="text-[13px] font-medium text-stone-600">正在寻找</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {OPEN_TO.map((id) => {
            const on = openTo.includes(id);
            return (
              <button
                key={id}
                type="button"
                onClick={() => toggleOpenTo(id)}
                className={`rounded-md px-3 py-1.5 text-sm ${on ? 'bg-brand-800 text-white' : 'bg-stone-100 text-stone-600'}`}
              >
                {OPEN_TO_LABELS[id]}
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <p className="text-[13px] font-medium text-stone-600">技能</p>
        {skills.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {skills.map((skill) => (
              <button key={skill} type="button" onClick={() => setSkills((prev) => prev.filter((item) => item !== skill))} className="rounded bg-brand-50 px-2 py-1 text-sm text-brand-800">
                {skill} ×
              </button>
            ))}
          </div>
        ) : null}
        <div className="mt-2 flex gap-2">
          <TextInput
            className="min-w-0 flex-1"
            value={skillDraft}
            maxLength={SKILL_MAX_LENGTH}
            placeholder="例如 Python、咨询"
            onChange={(e) => setSkillDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addSkill();
              }
            }}
          />
          <Button type="button" variant="secondary" onClick={addSkill}>
            添加
          </Button>
        </div>
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <div className="flex gap-2">
        <Button type="submit" loading={busy} className="flex-1">
          保存
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} className="flex-1">
          取消
        </Button>
      </div>
    </form>
  );
}
