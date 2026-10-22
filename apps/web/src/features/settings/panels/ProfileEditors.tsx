import { useState, type FormEvent } from 'react';
import { ABOUT_MAX, HEADLINE_MAX, LOCATION_MAX, OPEN_TO, SKILL_MAX_COUNT, SKILL_MAX_LENGTH, encodeProgramSelection, programChoiceState, readStoredProgramCodes, showsEnrollment, type MemberProfile, type MemberSelf, type OpenTo } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { useLabels, useTr } from '../../../shared/i18n/locale';
import { Button } from '../../../shared/ui/Button';
import { Notice } from '../../../shared/ui/Card';
import { Field, TextArea, TextInput } from '../../../shared/ui/Field';
import { ProgramPicker } from '../../auth/components/ProgramPicker';
import { profileApi } from '../../profile/api';

export function IntroEditor({ member, onSaved }: { member: MemberProfile; onSaved: (member: MemberSelf) => void }) {
  const tr = useTr();
  const stored = readStoredProgramCodes(member.major);
  const [headline, setHeadline] = useState(member.headline ?? '');
  const [location, setLocation] = useState(member.location ?? '');
  const [programs, setPrograms] = useState<string[] | null>(stored.kind === 'programs' ? stored.codes : stored.kind === 'empty' ? [] : null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const campus = showsEnrollment(member.role);
  const choice = programChoiceState(programs);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (campus && programs !== null && !choice.ready) return;
    setBusy(true);
    setError(null);
    try {
      const res = await profileApi.update({
        headline: headline.trim() || null,
        location: location.trim() || null,
        ...(campus && programs !== null ? { major: encodeProgramSelection(programs) } : {}),
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
      <Field label={tr('标题', 'Headline')}>
        <TextInput value={headline} maxLength={HEADLINE_MAX} placeholder={tr('例如 UTM 计算机 · 在找暑期实习', 'For example, UTM Computer Science · Looking for a summer internship')} onChange={(event) => setHeadline(event.target.value)} />
      </Field>
      <Field label={tr('所在地', 'Location')}>
        <TextInput value={location} maxLength={LOCATION_MAX} placeholder={tr('多伦多', 'Toronto')} onChange={(event) => setLocation(event.target.value)} />
      </Field>
      {campus ? <ProgramPicker programs={programs} onChange={setPrograms} legacyMajor={stored.kind === 'legacy' ? stored.text : null} /> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Button type="submit" block loading={busy} disabled={campus && programs !== null && !choice.ready}>
        {tr('保存', 'Save')}
      </Button>
    </form>
  );
}

export function AboutEditor({ member, onSaved }: { member: MemberProfile; onSaved: (member: MemberSelf) => void }) {
  const tr = useTr();
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
      <TextArea value={about} maxLength={ABOUT_MAX} placeholder={tr('你在学什么、做过什么、想认识谁', 'What you study, what you have done, and who you want to meet')} onChange={(event) => setAbout(event.target.value)} />
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Button type="submit" block loading={busy}>
        {tr('保存', 'Save')}
      </Button>
    </form>
  );
}

export function OpenToEditor({ member, onSaved }: { member: MemberProfile; onSaved: (member: MemberSelf) => void }) {
  const { tr, openTo: openToLabel } = useLabels();
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
              {openToLabel(id)}
            </button>
          );
        })}
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Button type="submit" block loading={busy}>
        {tr('保存', 'Save')}
      </Button>
    </form>
  );
}

export function SkillsEditor({ member, onChange }: { member: MemberProfile; onChange: (member: MemberSelf) => void }) {
  const tr = useTr();
  const [skills, setSkills] = useState<string[]>(member.skills ?? []);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function persist(next: string[]): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await profileApi.update({ skills: next });
      setSkills(res.member.skills);
      onChange(res.member);
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  // The typed skill stays in the box until it is saved, so a failed save does not lose it.
  // 输入的技能在保存成功前一直留在输入框里，保存失败也不会丢。
  async function add() {
    const skill = draft.trim();
    if (!skill || busy) return;
    if (skills.some((item) => item.toLocaleLowerCase() === skill.toLocaleLowerCase())) {
      setDraft('');
      setError(tr('这项技能已经添加过了', 'You already added this skill.'));
      return;
    }
    if (skill.length > SKILL_MAX_LENGTH) {
      setError(tr(`每项不超过 ${SKILL_MAX_LENGTH} 个字`, `Each skill can be ${SKILL_MAX_LENGTH} characters at most.`));
      return;
    }
    if (skills.length >= SKILL_MAX_COUNT) {
      setError(tr(`最多 ${SKILL_MAX_COUNT} 项`, `${SKILL_MAX_COUNT} skills at most.`));
      return;
    }
    if (await persist([...skills, skill])) setDraft((current) => (current.trim() === skill ? '' : current));
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
          placeholder={tr('例如 Python', 'e.g. Python')}
          enterKeyHint="done"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void add();
            }
          }}
        />
        <Button type="button" variant="secondary" onClick={() => void add()} loading={busy}>
          {tr('添加', 'Add')}
        </Button>
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
    </div>
  );
}
