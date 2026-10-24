import { useState, type ReactNode } from 'react';
import { OPEN_TO, isHonoraryRole, roleTitle, showsEnrollment, type ActivityPost, type Experience, type MemberProfile, type MemberSelf, type OpenTo } from '@utmmsc/shared';
import { useLabels, useTr } from '../../shared/i18n/locale';
import { useSessionStore } from '../../shared/session/store';
import { PlayGlyph } from '../moments/icons';
import { experiencePeriod } from './format';
import { CoverBanner } from './CoverBanner';
import { MemberAvatar } from './InitialAvatar';
import { CameraIcon, ChevronIcon, PlusIcon } from './icons';
import { useMediaUrl } from './media';

function openToLabels(member: MemberProfile, label: (id: OpenTo) => string): string[] {
  const picked = new Set(member.openTo ?? []);
  return OPEN_TO.filter((id) => picked.has(id)).map(label);
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

/** How many recent posts the profile shows as thumbnails, as WeChat does. */
/** 资料页以缩略图显示的最近动态条数，与微信一致。 */
const ALBUM_PREVIEWS = 4;

/**
 * One recent post in the profile's album row: the first photo's preview (the original for older photos), a
 * video's first frame under the play glyph (a dark tile when there is none, never a bare video), or the text
 * in a grey box.
 * 资料页相册一行中的一条最近动态：第一张照片的预览图（较早的照片用原图）、带播放标志的视频首帧（没有首帧时为深色格子，从不直接放视频），
 * 或灰色方框中的文字。
 */
function AlbumThumb({ post }: { post: ActivityPost }) {
  const first = post.media?.[0];
  const key = first ? (first.previewKey ?? (first.kind === 'image' ? first.key : null)) : null;
  const url = useMediaUrl(key);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (!first) {
    return (
      <span className="h-14 w-14 shrink-0 overflow-hidden bg-wx-bar p-1">
        <span className="line-clamp-3 break-all text-[11px] leading-[14px] text-wx-ink">{post.body}</span>
      </span>
    );
  }
  return (
    <span className={`relative h-14 w-14 shrink-0 overflow-hidden ${first.kind === 'video' ? 'bg-stone-800' : 'bg-stone-200'}`}>
      {url && url !== failedUrl ? (
        <img src={url} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setFailedUrl(url)} className="h-full w-full object-cover" />
      ) : null}
      {first.kind === 'video' ? (
        <span className="absolute inset-0 flex items-center justify-center">
          <PlayGlyph size={22} />
        </span>
      ) : null}
    </span>
  );
}

/**
 * The WeChat 朋友圈 row: up to four recent posts the viewer can see, opening the member's album. On the own
 * profile with nothing posted yet it offers 发表动态 instead, which opens the own album and its camera tile.
 * 微信式「朋友圈」一行：最多四条查看者能看到的最近动态，轻触打开该成员的相册。自己的资料页还没有发过动态时改为「发表动态」，
 * 打开自己的相册及其中的相机格子。
 */
function AlbumRow({ posts, own, onOpen }: { posts: ActivityPost[]; own: boolean; onOpen?: () => void }) {
  const tr = useTr();
  const recent = posts.slice(0, ALBUM_PREVIEWS);
  if (!onOpen && recent.length === 0) return null;
  if (own && onOpen && recent.length === 0) {
    return (
      <Block title={tr('动态', 'Updates')}>
        <AddRow label={tr('发表动态', 'Post an update')} onClick={onOpen} />
      </Block>
    );
  }
  const content = (
    <>
      <span className="w-14 shrink-0 text-[17px] font-semibold text-brand-800">{tr('动态', 'Updates')}</span>
      <span className="flex min-w-0 flex-1 gap-1.5 overflow-hidden" aria-hidden>
        {recent.map((post) => (
          <AlbumThumb key={post.id} post={post} />
        ))}
      </span>
    </>
  );
  return (
    <section className="bg-white">
      {onOpen ? (
        <button type="button" onClick={onOpen} className="flex min-h-[76px] w-full items-center gap-3 px-4 py-2.5 text-left active:bg-stone-50">
          {content}
          <span className="shrink-0 text-stone-300">
            <ChevronIcon />
          </span>
        </button>
      ) : (
        <div className="flex min-h-[76px] items-center gap-3 px-4 py-2.5">{content}</div>
      )}
    </section>
  );
}

function AboutText({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const tr = useTr();
  const long = text.length > 120;
  return (
    <div>
      <p className={`whitespace-pre-wrap break-words text-[15px] leading-relaxed text-stone-800 ${long && !open ? 'line-clamp-3' : ''}`}>{text}</p>
      {long ? (
        <button type="button" className="mt-1 text-[15px] text-brand-700" onClick={() => setOpen((value) => !value)}>
          {open ? tr('收起', 'Less') : tr('更多', 'More')}
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
  const { tr, role, enrollment, year, openTo, major, list } = useLabels();
  const looking = openToLabels(member, openTo);
  const title = roleTitle(member.role) ? role(member.role) : null;
  const school = [
    showsEnrollment(member.role) ? major(member.major) : null,
    showsEnrollment(member.role) ? year(member.graduationYear) : null,
    showsEnrollment(member.role) && !isHonoraryRole(member.role) ? enrollment(member.enrollmentStatus) : null,
  ].filter(Boolean).join(' · ');
  const skills = member.skills ?? [];
  const own = useSessionStore((s) => s.member?.id) === member.id;

  return (
    <div className="space-y-2">
      <header className="bg-white">
        <CoverBanner coverKey={member.coverKey} editable={Boolean(onCoverSaved)} onSaved={onCoverSaved} />
        <div className="px-4 pb-4">
          <div className="relative -mt-10 h-20 w-20">
            <MemberAvatar name={member.displayName} avatarKey={member.avatarKey} className={`h-20 w-20 text-2xl ring-4 ring-white ${avatarBusy ? 'opacity-50' : ''}`} />
            {onEditAvatar ? (
              <button type="button" aria-label={tr('换头像', 'Change profile photo')} onClick={onEditAvatar} className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full bg-brand-800 text-white ring-2 ring-white">
                <CameraIcon />
              </button>
            ) : null}
          </div>
          <div className="mt-3 flex items-start justify-between gap-2">
            <h1 className="text-[24px] font-semibold leading-tight text-brand-800">
              {member.displayName}
              {title ? <span className="ml-2 align-middle text-sm font-normal text-brand-700">{title}</span> : null}
            </h1>
            {onEditIntro ? <ActionChip label={tr('编辑', 'Edit')} onClick={onEditIntro} /> : null}
          </div>
          {member.headline ? <p className="mt-1 text-[15px] leading-snug text-stone-800">{member.headline}</p> : null}
          {member.location ? <p className="mt-1 text-sm text-stone-500">{member.location}</p> : null}
          {school ? <p className="mt-1 text-sm text-stone-500">{school}</p> : null}
          {looking.length > 0 || onEditOpenTo ? (
            onEditOpenTo ? (
              <button type="button" onClick={onEditOpenTo} className="mt-3 w-full rounded-lg bg-brand-50 px-3 py-2.5 text-left active:bg-brand-100">
                <span className="block text-[13px] text-brand-700">{tr('正在寻找', 'Open to')}</span>
                <span className="mt-0.5 block text-[15px] text-brand-800">{looking.length > 0 ? list(looking) : tr('还没有', 'Nothing yet')}</span>
              </button>
            ) : (
              <div className="mt-3 rounded-lg bg-brand-50 px-3 py-2.5">
                <span className="block text-[13px] text-brand-700">{tr('正在寻找', 'Open to')}</span>
                <span className="mt-0.5 block text-[15px] text-brand-800">{list(looking)}</span>
              </div>
            )
          ) : null}
          {action ? <div className="mt-4">{action}</div> : null}
        </div>
      </header>

      {member.about || onEditAbout ? (
        <Block
          title={tr('简介', 'About')}
          action={onEditAbout && member.about ? <ActionChip label={tr('编辑', 'Edit')} onClick={onEditAbout} /> : null}
        >
          {member.about ? <AboutText text={member.about} /> : null}
          {!member.about && onEditAbout ? <AddRow label={tr('添加简介', 'Add an about section')} onClick={onEditAbout} /> : null}
        </Block>
      ) : null}

      {experiences.length > 0 || onAddExperience ? (
        <Block
          title={tr('经历', 'Experience')}
          action={onAddExperience && experiences.length > 0 ? <ActionChip label={tr('添加', 'Add')} onClick={onAddExperience} /> : null}
        >
          {experiences.length > 0 ? (
            <div className="divide-y divide-stone-200">
              {experiences.map((item) => (
                <div key={item.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-semibold text-brand-800">{item.title}</p>
                    {onDeleteExperience ? (
                      <button type="button" aria-label={tr('删除这条经历', 'Delete this experience')} onClick={() => onDeleteExperience(item.id)} className="flex h-11 w-11 shrink-0 items-center justify-center text-stone-400">
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
            <AddRow label={tr('添加经历', 'Add experience')} onClick={() => onAddExperience?.()} />
          )}
        </Block>
      ) : null}

      {skills.length > 0 || onEditSkills ? (
        <Block
          title={tr('技能', 'Skills')}
          action={onEditSkills && skills.length > 0 ? <ActionChip label={tr('编辑', 'Edit')} onClick={onEditSkills} /> : null}
        >
          {skills.length > 0 ? <p className="text-[15px] leading-relaxed text-stone-800">{skills.join(' · ')}</p> : null}
          {skills.length === 0 && onEditSkills ? <AddRow label={tr('添加技能', 'Add skills')} onClick={onEditSkills} /> : null}
        </Block>
      ) : null}

      <AlbumRow posts={posts} own={own} onOpen={onShowActivity} />
    </div>
  );
}
