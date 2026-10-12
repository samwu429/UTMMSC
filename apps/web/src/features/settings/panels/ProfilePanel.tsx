import { useEffect, useState } from 'react';
import type { Experience, MemberDetailResponse, MemberSelf, PresetAvatarId, PresetAvatarMotion } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { useSessionStore } from '../../../shared/session/store';
import { Notice, Spinner } from '../../../shared/ui/Card';
import { AvatarChooser } from '../../profile/AvatarChooser';
import { ExperienceForm } from '../../profile/ExperienceForm';
import { MemberProfileView } from '../../profile/MemberProfileView';
import { Sheet } from '../../profile/Sheet';
import { profileApi } from '../../profile/api';
import { AboutEditor, IntroEditor, OpenToEditor, SkillsEditor } from './ProfileEditors';

type SheetName = 'intro' | 'about' | 'open' | 'skills' | 'experience' | 'avatar';

function sortExperiences(items: Experience[]): Experience[] {
  return [...items].sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1;
    return (b.startYear ?? 0) - (a.startYear ?? 0);
  });
}

export function ProfilePanel({ onShowActivity }: { onShowActivity: () => void }) {
  const selfId = useSessionStore((s) => s.member?.id);
  const setMember = useSessionStore((s) => s.setMember);
  const setMediaToken = useSessionStore((s) => s.setMediaToken);
  const [detail, setDetail] = useState<MemberDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetName | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);

  useEffect(() => {
    if (!selfId) return;
    let cancelled = false;
    profileApi
      .detail(selfId)
      .then((res) => {
        if (cancelled) return;
        setDetail(res);
        setMediaToken(res.mediaToken);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [selfId, setMediaToken]);

  function applyMember(member: MemberSelf, close: boolean) {
    setMember(member);
    setDetail((prev) => (prev ? { ...prev, member } : prev));
    if (close) setSheet(null);
  }

  async function removeExperience(id: string) {
    if (!window.confirm('删除这条经历？')) return;
    setError(null);
    try {
      await profileApi.removeExperience(id);
      setDetail((prev) => (prev ? { ...prev, experiences: prev.experiences.filter((item) => item.id !== id) } : prev));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function choosePreset(id: PresetAvatarId, motion: PresetAvatarMotion) {
    setAvatarBusy(true);
    setError(null);
    try {
      const res = await profileApi.choosePreset(id, motion);
      applyMember(res.member, true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setAvatarBusy(false);
    }
  }

  async function pickAvatar(file: File) {
    setAvatarBusy(true);
    setError(null);
    try {
      const res = await profileApi.uploadAvatar(file);
      applyMember(res.member, true);
      setMediaToken(res.mediaToken);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setAvatarBusy(false);
    }
  }

  async function removeAvatar() {
    setAvatarBusy(true);
    setError(null);
    try {
      const res = await profileApi.removeAvatar();
      applyMember(res.member, true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setAvatarBusy(false);
    }
  }

  function created(experience: Experience) {
    setDetail((prev) => (prev ? { ...prev, experiences: sortExperiences([experience, ...prev.experiences]) } : prev));
    setSheet(null);
  }

  if (!selfId) return null;
  if (error && !detail) return <Notice tone="error">{error}</Notice>;
  if (!detail) return <Spinner />;

  return (
    <div>
      {error ? <div className="px-4 pt-3"><Notice tone="error">{error}</Notice></div> : null}
      <MemberProfileView
        member={detail.member}
        experiences={detail.experiences}
        posts={detail.posts}
        onEditIntro={() => setSheet('intro')}
        onEditAbout={() => setSheet('about')}
        onEditOpenTo={() => setSheet('open')}
        onEditSkills={() => setSheet('skills')}
        onAddExperience={() => setSheet('experience')}
        onDeleteExperience={removeExperience}
        onShowActivity={onShowActivity}
        onEditAvatar={() => setSheet('avatar')}
        avatarBusy={avatarBusy}
      />
      {sheet === 'intro' ? (
        <Sheet title="编辑资料" onClose={() => setSheet(null)}>
          <IntroEditor member={detail.member} onSaved={(member) => applyMember(member, true)} />
        </Sheet>
      ) : null}
      {sheet === 'about' ? (
        <Sheet title="编辑简介" onClose={() => setSheet(null)}>
          <AboutEditor member={detail.member} onSaved={(member) => applyMember(member, true)} />
        </Sheet>
      ) : null}
      {sheet === 'open' ? (
        <Sheet title="正在寻找" onClose={() => setSheet(null)}>
          <OpenToEditor member={detail.member} onSaved={(member) => applyMember(member, true)} />
        </Sheet>
      ) : null}
      {sheet === 'skills' ? (
        <Sheet title="技能" closeLabel="完成" onClose={() => setSheet(null)}>
          <SkillsEditor member={detail.member} onChange={(member) => applyMember(member, false)} />
        </Sheet>
      ) : null}
      {sheet === 'avatar' ? (
        <Sheet title="选择头像" onClose={() => setSheet(null)}>
          <AvatarChooser currentKey={detail.member.avatarKey} busy={avatarBusy} onPreset={choosePreset} onUpload={pickAvatar} onRemove={removeAvatar} />
        </Sheet>
      ) : null}
      {sheet === 'experience' ? (
        <Sheet title="添加经历" onClose={() => setSheet(null)}>
          <ExperienceForm onCreated={created} />
        </Sheet>
      ) : null}
    </div>
  );
}
