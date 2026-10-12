import { ENROLLMENT_LABELS, FILE_CATEGORY_LABELS, ROLE_DUTIES, ROLE_LABELS, enrollmentYearLabel, type EnrollmentStatus, type FileCategory, type Role } from '@utmmsc/shared';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Locale = 'zh' | 'en';

interface LocaleState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

/** The site language stays on this device. Chinese is the default. */
/** 网站语言保存在这台设备上。默认是中文。 */
export const useLocaleStore = create<LocaleState>()(
  persist(
    (set) => ({
      locale: 'zh',
      setLocale: (locale) => set({ locale }),
    }),
    { name: 'utmmsc.locale' },
  ),
);

export function useTr() {
  const locale = useLocaleStore((s) => s.locale);
  return (zh: string, en: string) => (locale === 'en' ? en : zh);
}

const ROLE_EN: Record<Role, string> = {
  student: 'Student',
  alumni: 'Graduate',
  honorary_alumni: 'Alumni honorary advisor',
  honorary_external: 'External honorary advisor',
  head_technology: 'Head of Technology',
  head_academic: 'Head of Academic Affairs',
  head_publicity: 'Head of Publicity',
  head_sponsorship: 'Head of Sponsorship',
  head_events: 'Head of Events',
  secretary_general: 'Secretary-General',
  vp_finance: 'Vice President, Finance',
  vp_audit: 'Vice President, Audit',
  president: 'President',
  superadmin: 'System administrator',
};

const DUTY_EN: Record<Role, string> = {
  student: 'Ordinary member.',
  alumni: 'Ordinary member.',
  honorary_alumni: 'Alumni honorary advisor. Same access as an ordinary member. Only a system administrator can assign this, and there can be more than one.',
  honorary_external: 'External honorary advisor. Same access as an ordinary member. Joins only through a system administrator invitation, and there can be more than one.',
  head_technology: 'Website, systems, and projects. Can upload files. Technology only.',
  head_academic: 'Academic support. Can upload files. Academic affairs only.',
  head_publicity: 'Publicity and recruitment. Can upload files. Publicity only.',
  head_sponsorship: 'Reviews sponsorships. Can upload files. Sponsorship only.',
  head_events: 'Plans events. Can publish events and upload files. Events only.',
  secretary_general: 'Membership list, meeting notices, and records. Can approve members, upload files, and send notices.',
  vp_finance: 'Income, spending, and budgets. Can upload finance files. Does not manage anything else.',
  vp_audit: 'Reviews accounts and records. Cannot change roles or sign for someone else.',
  president: 'Runs the organization. Can appoint department heads, review members, manage channels, and send announcements and events.',
  superadmin: 'System account with full access. Not an office in the constitution.',
};

const GROUP_EN: Record<string, string> = {
  成员: 'Members',
  荣誉顾问: 'Honorary advisors',
  部门: 'Departments',
  主席团: 'Presidium',
  系统: 'System',
};

const FILE_EN: Record<FileCategory, string> = {
  governance: 'Club governance',
  'event-plans': 'Event plans',
  departments: 'Department files',
};

export function useLabels() {
  const locale = useLocaleStore((s) => s.locale);
  const tr = (zh: string, en: string) => (locale === 'en' ? en : zh);
  return {
    locale,
    tr,
    role: (role: Role) => (locale === 'en' ? ROLE_EN[role] : ROLE_LABELS[role]),
    duty: (role: Role) => (locale === 'en' ? DUTY_EN[role] : ROLE_DUTIES[role]),
    group: (label: string) => (locale === 'en' ? (GROUP_EN[label] ?? label) : label),
    enrollment: (status: EnrollmentStatus) => (locale === 'en' ? (status === 'student' ? 'Student' : 'Graduate') : ENROLLMENT_LABELS[status]),
    year: (year: number) => (locale === 'en' ? `Entered ${year}` : enrollmentYearLabel(year)),
    fileCategory: (category: FileCategory) => (locale === 'en' ? FILE_EN[category] : FILE_CATEGORY_LABELS[category]),
  };
}
