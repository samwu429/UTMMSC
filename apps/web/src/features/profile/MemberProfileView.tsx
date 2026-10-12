import type { ReactNode } from 'react';
import { ENROLLMENT_LABELS, OPEN_TO, OPEN_TO_LABELS, ROLE_LABELS, isStaffRole, type ActivityPost, type Experience, type MemberProfile } from '@utmmsc/shared';
import { Card } from '../../shared/ui/Card';
import { experiencePeriod, formatPostTime } from './format';

function openToLine(member: MemberProfile): string {
  const picked = new Set(member.openTo ?? []);
  const labels = OPEN_TO.filter((id) => picked.has(id)).map((id) => OPEN_TO_LABELS[id]);
  return labels.length ? `正在寻找${labels.join('、')}` : '';
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-medium text-brand-800">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function MemberProfileView({
  member,
  experiences,
  posts,
  self = false,
  onEdit,
  onDeleteExperience,
  experienceAction,
  onShowActivity,
  onDeletePost,
}: {
  member: MemberProfile;
  experiences: Experience[];
  posts: ActivityPost[];
  self?: boolean;
  onEdit?: () => void;
  onDeleteExperience?: (id: string) => void;
  experienceAction?: ReactNode;
  onShowActivity?: () => void;
  onDeletePost?: (id: string) => void;
}) {
  const looking = openToLine(member);
  const meta = [member.location, member.major, `${member.graduationYear} 届`, ENROLLMENT_LABELS[member.enrollmentStatus]]
    .filter(Boolean)
    .join(' · ');
  const skills = member.skills ?? [];

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-xl bg-white ring-1 ring-stone-200">
        <div className="h-16 bg-brand-800">
          <div className="h-1 bg-gold" />
        </div>
        <div className="px-4 pb-4">
          <div className="-mt-7 flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 text-xl font-semibold text-brand-800 ring-4 ring-white">
            {member.displayName.slice(0, 1)}
          </div>
          <div className="mt-3 flex items-start justify-between gap-3">
            <h1 className="text-[22px] font-semibold tracking-tight text-brand-800">
              {member.displayName}
              {isStaffRole(member.role) ? <span className="ml-2 align-middle text-sm font-normal text-brand-700">{ROLE_LABELS[member.role]}</span> : null}
            </h1>
            {onEdit ? (
              <button type="button" onClick={onEdit} className="shrink-0 pt-1 text-sm font-medium text-brand-800">
                编辑资料
              </button>
            ) : null}
          </div>
          {member.headline ? <p className="mt-1 text-[15px] leading-snug text-stone-700">{member.headline}</p> : null}
          {self && !member.headline ? <p className="mt-1 text-sm text-stone-400">加一句话介绍，让别人知道你在做什么</p> : null}
          <p className="mt-2 text-sm text-stone-500">{meta}</p>
          {looking ? <p className="mt-2 text-sm text-brand-800">{looking}</p> : null}
          {self && !looking ? <p className="mt-2 text-sm text-stone-400">可以标明你在找实习、升学或校友交流</p> : null}
        </div>
      </div>

      {member.about || self ? (
        <Section title="简介">
          {member.about ? (
            <Card>
              <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-stone-800">{member.about}</p>
            </Card>
          ) : (
            <p className="text-sm leading-relaxed text-stone-500">写一段你在学什么、做过什么、想认识什么样的人。</p>
          )}
        </Section>
      ) : null}

      {skills.length > 0 || self ? (
        <Section title="技能">
          {skills.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {skills.map((skill) => (
                <span key={skill} className="rounded bg-brand-50 px-2 py-1 text-sm text-brand-800">
                  {skill}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-stone-500">加上专业、工具或兴趣，别人搜成员时能找到你。</p>
          )}
        </Section>
      ) : null}

      {experiences.length > 0 || self || experienceAction ? (
        <Section title="经历">
          {experiences.length > 0 ? (
            <div className="divide-y divide-stone-200 overflow-hidden rounded-xl bg-white ring-1 ring-stone-200">
              {experiences.map((item) => (
                <div key={item.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-brand-800">{item.title}</p>
                      <p className="text-sm text-stone-600">{item.organization}</p>
                      <p className="text-sm text-stone-400">{experiencePeriod(item)}</p>
                    </div>
                    {onDeleteExperience ? (
                      <button type="button" onClick={() => onDeleteExperience(item.id)} className="shrink-0 text-xs text-stone-400">
                        删除
                      </button>
                    ) : null}
                  </div>
                  {item.description ? <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-stone-700">{item.description}</p> : null}
                </div>
              ))}
            </div>
          ) : self ? (
            <p className="mb-3 text-sm leading-relaxed text-stone-500">实习、科研、社团职务或项目都可以记在这里。</p>
          ) : null}
          {experienceAction}
        </Section>
      ) : null}

      {posts.length > 0 || self ? (
        <Section
          title="动态"
          action={
            onShowActivity ? (
              <button type="button" onClick={onShowActivity} className="text-sm text-brand-800">
                写一条
              </button>
            ) : null
          }
        >
          {posts.length > 0 ? (
            <div className="divide-y divide-stone-200 overflow-hidden rounded-xl bg-white ring-1 ring-stone-200">
              {posts.map((post) => (
                <div key={post.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-stone-400">{formatPostTime(post.createdAt)}</p>
                    {onDeletePost ? (
                      <button type="button" onClick={() => onDeletePost(post.id)} className="text-xs text-stone-400">
                        删除
                      </button>
                    ) : null}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-stone-800">{post.body}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-stone-500">还没有动态。近况、机会或想说的话可以发在这里。</p>
          )}
        </Section>
      ) : null}
    </div>
  );
}
