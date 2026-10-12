import { useState, type ReactNode } from 'react';
import { ENROLLMENT_LABELS, OPEN_TO, OPEN_TO_LABELS, ROLE_LABELS, enrollmentYearLabel, formatStoredMajor, isStaffRole, type ActivityPost, type Experience, type MemberProfile, type MemberSelf } from '@utmmsc/shared';
import { experiencePeriod, formatPostTime } from './format';
import { CoverBanner } from './CoverBanner';
import { MemberAvatar } from './InitialAvatar';
import { CameraIcon, ChevronIcon, PlusIcon } from './icons';
import { PostMediaView } from './PostMediaView';

function openToLabels(member: MemberProfile): string[] {
  const picked = new Set(member.openTo ?? []);
  return OPEN_TO.filter((id) => picked.has(id)).map((id) => OPEN_TO_LABELS[id]);
}

function ActionChip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="min-h-9 rounded-full bg-stone-100 px-3 text-sm font-medium text-brand-800 active:bg-stone-200">
      {label}
    </button>
  );
}

function AddRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg bg-stone-100 text-[15px] font-medium text-brand-800 active:bg-stone-200">
      <PlusIcon />
      {label}
    </button>
  );
}

function Block({ title, action, children }: { title: string; action?: ReactNode; children?: ReactNode }) {
  return (
    <section className="bg-white px-4 py-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[17px] font-semibold text-brand-800">{title}</h2>
        {action}
      </div>
      {children ? <div className="mt-3">{children}</div> : null}
    </section>
  );
}

function AboutText({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 120;
  return (
    <div>
      <p className={`whitespace-pre-wrap break-words text-[15px] leading-relaxed text-stone-800 ${long && !open ? 'line-clamp-3' : ''}`}>{text}</p>
      {long ? (
        <button type="button" className="mt-1 text-[15px] text-brand-700" onClick={() => setOpen((value) => !value)}>
          {open ? '收起' : '更多'}
        </button>
      ) : null}
    </div>
  );
}

export function MemberProfileView({
  member,
  experiences,
  posts,
  onEditIntro,
  onEditAbout,
  onEditOpenTo,
  onEditSkills,
  onAddExperience,
  onDeleteExperience,
  onShowActivity,
  onEditAvatar,
  onCoverSaved,
  avatarBusy,
  action,
}: {
  member: MemberProfile;
  experiences: Experience[];
  posts: ActivityPost[];
  onEditIntro?: () => void;
  onEditAbout?: () => void;
  onEditOpenTo?: () => void;
  onEditSkills?: () => void;
  onAddExperience?: () => void;
  onDeleteExperience?: (id: string) => void;
  onShowActivity?: () => void;
  onEditAvatar?: () => void;
  onCoverSaved?: (member: MemberSelf) => void;
  avatarBusy?: boolean;
  action?: ReactNode;
}) {
  const looking = openToLabels(member);
  const school = [formatStoredMajor(member.major), enrollmentYearLabel(member.graduationYear), ENROLLMENT_LABELS[member.enrollmentStatus]].filter(Boolean).join(' · ');
  const skills = member.skills ?? [];
  const preview = posts.slice(0, 2);

  return (
    <div className="space-y-2">
      <header className="bg-white">
        <CoverBanner coverKey={member.coverKey} editable={Boolean(onCoverSaved)} onSaved={onCoverSaved} />
        <div className="px-4 pb-4">
          <div className="relative -mt-10 h-20 w-20">
            <MemberAvatar name={member.displayName} avatarKey={member.avatarKey} className={`h-20 w-20 text-2xl ring-4 ring-white ${avatarBusy ? 'opacity-50' : ''}`} />
            {onEditAvatar ? (
              <button type="button" aria-label="换头像" onClick={onEditAvatar} className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full bg-brand-800 text-white ring-2 ring-white">
                <CameraIcon />
              </button>
            ) : null}
          </div>
          <div className="mt-3 flex items-start justify-between gap-2">
            <h1 className="text-[24px] font-semibold leading-tight text-brand-800">
              {member.displayName}
              {isStaffRole(member.role) ? <span className="ml-2 align-middle text-sm font-normal text-brand-700">{ROLE_LABELS[member.role]}</span> : null}
            </h1>
            {onEditIntro ? <ActionChip label="编辑" onClick={onEditIntro} /> : null}
          </div>
          {member.headline ? <p className="mt-1 text-[15px] leading-snug text-stone-800">{member.headline}</p> : null}
          {member.location ? <p className="mt-1 text-sm text-stone-500">{member.location}</p> : null}
          <p className="mt-1 text-sm text-stone-500">{school}</p>
          {looking.length > 0 || onEditOpenTo ? (
            onEditOpenTo ? (
              <button type="button" onClick={onEditOpenTo} className="mt-3 w-full rounded-lg bg-brand-50 px-3 py-2.5 text-left active:bg-brand-100">
                <span className="block text-[13px] text-brand-700">正在寻找</span>
                <span className="mt-0.5 block text-[15px] text-brand-800">{looking.length > 0 ? looking.join('、') : '还没有'}</span>
              </button>
            ) : (
              <div className="mt-3 rounded-lg bg-brand-50 px-3 py-2.5">
                <span className="block text-[13px] text-brand-700">正在寻找</span>
                <span className="mt-0.5 block text-[15px] text-brand-800">{looking.join('、')}</span>
              </div>
            )
          ) : null}
          {action ? <div className="mt-4">{action}</div> : null}
        </div>
      </header>

      {member.about || onEditAbout ? (
        <Block
          title="简介"
          action={onEditAbout && member.about ? <ActionChip label="编辑" onClick={onEditAbout} /> : null}
        >
          {member.about ? <AboutText text={member.about} /> : null}
          {!member.about && onEditAbout ? <AddRow label="添加简介" onClick={onEditAbout} /> : null}
        </Block>
      ) : null}

      {experiences.length > 0 || onAddExperience ? (
        <Block
          title="经历"
          action={onAddExperience && experiences.length > 0 ? <ActionChip label="添加" onClick={onAddExperience} /> : null}
        >
          {experiences.length > 0 ? (
            <div className="divide-y divide-stone-200">
              {experiences.map((item) => (
                <div key={item.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-semibold text-brand-800">{item.title}</p>
                    {onDeleteExperience ? (
                      <button type="button" aria-label="删除这条经历" onClick={() => onDeleteExperience(item.id)} className="flex h-11 w-11 shrink-0 items-center justify-center text-stone-400">
                        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden>
                          <path d="M5 7h14M9 7V5h6v2M8 7l.7 12h6.6L16 7" />
                        </svg>
                      </button>
                    ) : null}
                  </div>
                  <p className="text-[15px] text-stone-700">{item.organization}</p>
                  <p className="text-sm text-stone-400">{experiencePeriod(item)}</p>
                  {item.description ? <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-stone-700">{item.description}</p> : null}
                </div>
              ))}
            </div>
          ) : (
            <AddRow label="添加经历" onClick={() => onAddExperience?.()} />
          )}
        </Block>
      ) : null}

      {skills.length > 0 || onEditSkills ? (
        <Block
          title="技能"
          action={onEditSkills && skills.length > 0 ? <ActionChip label="编辑" onClick={onEditSkills} /> : null}
        >
          {skills.length > 0 ? <p className="text-[15px] leading-relaxed text-stone-800">{skills.join(' · ')}</p> : null}
          {skills.length === 0 && onEditSkills ? <AddRow label="添加技能" onClick={onEditSkills} /> : null}
        </Block>
      ) : null}

      {preview.length > 0 || onShowActivity ? (
        <section className="bg-white px-4 py-4">
          {onShowActivity && preview.length > 0 ? (
            <button type="button" onClick={onShowActivity} className="flex min-h-11 w-full items-center justify-between">
              <h2 className="text-[17px] font-semibold text-brand-800">动态</h2>
              <span className="text-stone-300">
                <ChevronIcon />
              </span>
            </button>
          ) : (
            <h2 className="text-[17px] font-semibold text-brand-800">动态</h2>
          )}
          {preview.length > 0 ? (
            <div className="mt-1 divide-y divide-stone-200">
              {preview.map((post) => (
                <div key={post.id} className="py-3 first:pt-0 last:pb-0">
                  {post.body ? <p className="line-clamp-4 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-stone-800">{post.body}</p> : null}
                  <PostMediaView media={(post.media ?? []).slice(0, 1)} />
                  <p className="mt-1 text-xs text-stone-400">{formatPostTime(post.createdAt)}</p>
                </div>
              ))}
            </div>
          ) : onShowActivity ? (
            <div className="mt-3">
              <AddRow label="发表动态" onClick={onShowActivity} />
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
