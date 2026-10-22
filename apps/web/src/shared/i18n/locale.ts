import {
  ENROLLMENT_LABELS,
  FILE_CATEGORY_LABELS,
  OPEN_TO_LABELS,
  PROGRAM_RULE_SUMMARY,
  ROLE_DUTIES,
  ROLE_LABELS,
  enrollmentYearLabel,
  formatStoredMajor,
  readStoredProgramCodes,
  type EnrollmentStatus,
  type FileCategory,
  type OpenTo,
  type Role,
} from '@utmmsc/shared';
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

/** For code outside components. It reads the language when called, so the calling component must also subscribe. */
/** 给组件以外的代码用。调用时才读取语言，所以调用它的组件也要订阅语言。 */
export function tr(zh: string, en: string): string {
  return useLocaleStore.getState().locale === 'en' ? en : zh;
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

const OPEN_TO_EN: Record<OpenTo, string> = {
  internship: 'Internships',
  fulltime: 'Full-time jobs',
  study: 'Further study',
  research: 'Research',
  alumni: 'Alumni connections',
  project: 'Project partners',
};

/** Program rules and checks from the shared package, which the API also returns as errors. */
/** 共享包里的专业规则和检查结果，接口报错时也会返回这些文字。 */
export const PROGRAM_EN: Record<string, string> = {
  [PROGRAM_RULE_SUMMARY]:
    'Once you have 4.0 credits, choose one specialist, two majors, or one major and two minors. Three programs at most, and with three, one must be a minor. A specialist can add minors, and two majors can add one minor. A specialist cannot be combined with a major, and two specialists are not allowed. Minors alone are not allowed. If you have not chosen a program yet, tick "No program selected".',
  '请选择「尚未选择专业」，或组成符合校历的项目': 'Tick "No program selected", or choose a combination the academic calendar allows.',
  '已选：尚未选择专业': 'Selected: no program yet.',
  '这个组合可以提交': 'This combination can be submitted.',
  '尚未选择专业不能和其他项目一起选': '"No program selected" cannot be combined with a program.',
  '同一项目不能重复选择': 'The same program cannot be chosen twice.',
  '有无法识别的项目': 'One of the programs is not recognized.',
  '同一编号的 specialist、major 和 minor 不能同时选择': 'A specialist, major, and minor with the same code cannot be chosen together.',
  'specialist 最多两个': 'At most two specialists.',
  'major 最多两个': 'At most two majors.',
  '最多选择三个项目': 'Choose three programs at most.',
  '只选 minor 不能作为完整组合': 'Minors alone are not a complete combination.',
  'specialist 不能和 major 组合': 'A specialist cannot be combined with a major.',
  '两个 specialist 不能作为完整组合': 'Two specialists are not a complete combination.',
  '一个 major 需要再加一个 major，或配两个 minor': 'One major needs a second major, or two minors.',
  '这个组合不符合校历': 'The academic calendar does not allow this combination.',
  '请从列表中选择项目': 'Choose programs from the list.',
  '专业过长': 'The program selection is too long.',
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
    openTo: (id: OpenTo) => (locale === 'en' ? OPEN_TO_EN[id] : OPEN_TO_LABELS[id]),
    program: (message: string) => (locale === 'en' ? (PROGRAM_EN[message] ?? message) : message),
    list: (items: string[]) => items.join(tr('、', ', ')),
    major: (stored: string | null | undefined) => {
      const text = formatStoredMajor(stored);
      // Calendar program names never contain 、, so only chosen programs are re-joined. Free text stays as typed.
      // 校历里的项目名不含「、」，所以只重新连接选出来的项目，手写的旧内容保持原样。
      if (locale !== 'en' || !text || readStoredProgramCodes(stored).kind !== 'programs') return text;
      return text.split('、').join(', ');
    },
  };
}
