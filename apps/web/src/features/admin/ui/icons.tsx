import type { ReactNode } from 'react';
import type { AdminSectionKey } from '@utmmsc/shared';

/** Line glyphs of admin, drawn like the 发现 page icons: 24px box, 1.75 stroke, round ends. */
/** 管理后台的线条图标，画法与「发现」页的图标一致：24px 画框、1.75 线宽、圆头。 */
export type AdminIconName = AdminSectionKey | 'overview' | 'plus' | 'search' | 'close' | 'check' | 'back' | 'chevron' | 'profile';

const PATHS: Record<AdminIconName, ReactNode> = {
  overview: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.6" />
      <rect x="13" y="4" width="7" height="4.5" rx="1.4" />
      <rect x="13" y="11" width="7" height="9" rx="1.6" />
      <rect x="4" y="13" width="7" height="7" rx="1.6" />
    </>
  ),
  review: (
    <>
      <path d="M5 5.5h14a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1Z" />
      <path d="M4 13h4.5l1.2 2h4.6l1.2-2H20" />
      <path d="m9.2 9.2 1.9 1.9 3.7-3.7" />
    </>
  ),
  members: (
    <>
      <circle cx="9" cy="9" r="2.5" />
      <path d="M4.5 18.5c.6-2.2 2.4-3.5 4.5-3.5s3.9 1.3 4.5 3.5" />
      <circle cx="16" cy="9.5" r="2" />
      <path d="M16 15c1.6.2 3 1.2 3.6 3" />
    </>
  ),
  advisors: (
    <>
      <path d="M4.5 7.5h15v10a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-10Z" />
      <path d="m4.5 7.5 7.5 5.5 7.5-5.5" />
      <path d="m15.5 3.8.8 1.6 1.7.2-1.2 1.2.3 1.7-1.6-.8-1.5.8.3-1.7-1.2-1.2 1.6-.2.8-1.6Z" />
    </>
  ),
  channels: (
    <>
      <path d="M4.5 6h11a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H9l-3.5 2.5v-2.5h-1a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z" />
      <path d="M16.5 9.5h3a1 1 0 0 1 1 1V17a1 1 0 0 1-1 1h-1v2l-2.8-2H12a1 1 0 0 1-1-1v-1" />
    </>
  ),
  events: (
    <>
      <rect x="4" y="5.5" width="16" height="14" rx="1.6" />
      <path d="M4 10h16M8.5 3.5v3.5M15.5 3.5v3.5" />
      <path d="M8 13.5h2.5M13.5 13.5H16M8 16.5h2.5" />
    </>
  ),
  announcements: (
    <>
      <path d="M4 10v4a1 1 0 0 0 1 1h2l6 4V5L7 9H5a1 1 0 0 0-1 1Z" />
      <path d="M16.5 9a4 4 0 0 1 0 6M18.8 6.5a7.5 7.5 0 0 1 0 11" />
    </>
  ),
  reports: (
    <>
      <path d="M12 3.5 19 6v5.5c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6l7-2.5Z" />
      <path d="M12 8v4.5M12 15.5v.5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="m20 20-4.5-4.5" />
    </>
  ),
  close: <path d="m6 6 12 12M18 6 6 18" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  back: <path d="m14 6-6 6 6 6" />,
  chevron: <path d="m9 5 7 7-7 7" />,
  profile: (
    <>
      <circle cx="12" cy="9" r="3" />
      <path d="M6 19.5c.9-2.6 3-4 6-4s5.1 1.4 6 4" />
    </>
  ),
};

export function AdminIcon({ name, className = 'h-5 w-5', strokeWidth = 1.75 }: { name: AdminIconName; className?: string; strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {PATHS[name]}
    </svg>
  );
}

/** The 32px brand tile that leads a section row. */
/** 板块行开头 32px 的品牌色图块。 */
export function IconTile({ name, tone = 'brand' }: { name: AdminIconName; tone?: 'brand' | 'gold' | 'muted' }) {
  const style = tone === 'gold' ? 'bg-gold text-brand-800' : tone === 'muted' ? 'bg-stone-200 text-stone-600' : 'bg-brand-800 text-white';
  return (
    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${style}`}>
      <AdminIcon name={name} className="h-[18px] w-[18px]" />
    </span>
  );
}
