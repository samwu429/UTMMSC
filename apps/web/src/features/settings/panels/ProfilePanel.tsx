import { useEffect, useState } from 'react';
import type { Experience, MemberDetailResponse, MemberSelf } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { useSessionStore } from '../../../shared/session/store';
import { Notice, Spinner } from '../../../shared/ui/Card';
import { ExperienceForm } from '../../profile/ExperienceForm';
import { MemberProfileView } from '../../profile/MemberProfileView';
import { profileApi } from '../../profile/api';
import { EditProfileForm } from './EditProfileForm';

function sortExperiences(items: Experience[]): Experience[] {
  return [...items].sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1;
    return (b.startYear ?? 0) - (a.startYear ?? 0);
  });
}

export function ProfilePanel({ onShowActivity }: { onShowActivity: () => void }) {
  const self = useSessionStore((s) => s.member);
  const selfId = self?.id;
  const setMember = useSessionStore((s) => s.setMember);
  const [detail, setDetail] = useState<MemberDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!selfId) return;
    let cancelled = false;
    profileApi
      .detail(selfId)
      .then((res) => {
        if (!cancelled) setDetail(res);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [selfId]);

  async function removeExperience(id: string) {
    if (!window.confirm('删除这条经历？')) return;
    try {
      await profileApi.removeExperience(id);
      setDetail((prev) => (prev ? { ...prev, experiences: prev.experiences.filter((item) => item.id !== id) } : prev));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function removePost(id: string) {
    if (!window.confirm('删除这条动态？')) return;
    try {
      await profileApi.removePost(id);
      setDetail((prev) => (prev ? { ...prev, posts: prev.posts.filter((item) => item.id !== id) } : prev));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function saved(member: MemberSelf) {
    setMember(member);
    setDetail((prev) => (prev ? { ...prev, member } : prev));
    setEditing(false);
  }

  function created(experience: Experience) {
    setDetail((prev) => (prev ? { ...prev, experiences: sortExperiences([experience, ...prev.experiences]) } : prev));
  }

  if (!self) return null;
  if (error && !detail) return <Notice tone="error">{error}</Notice>;
  if (!detail) return <Spinner />;

  return (
    <div className="space-y-4">
      {error ? <Notice tone="error">{error}</Notice> : null}
      {editing ? (
        <EditProfileForm member={detail.member} onCancel={() => setEditing(false)} onSaved={saved} />
      ) : (
        <MemberProfileView
          member={detail.member}
          experiences={detail.experiences}
          posts={detail.posts}
          self
          onEdit={() => setEditing(true)}
          onDeleteExperience={removeExperience}
          onDeletePost={removePost}
          onShowActivity={onShowActivity}
          experienceAction={<ExperienceForm onCreated={created} />}
        />
      )}
    </div>
  );
}
