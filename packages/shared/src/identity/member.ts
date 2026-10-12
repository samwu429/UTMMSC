import type { OpenTo } from './profile';
import type { Role } from './roles';

export const ENROLLMENT_STATUSES = ['student', 'alumni'] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

export const ENROLLMENT_LABELS: Record<EnrollmentStatus, string> = {
  student: '在校生',
  alumni: '毕业生',
};

export const MEMBER_STATUSES = ['active', 'pending', 'disabled'] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

/** Public profile visible to other members. Email is intentionally absent. */
/** 对其他成员可见的公开资料。有意不包含邮箱。 */
export interface MemberProfile {
  id: string;
  displayName: string;
  role: Role;
  enrollmentStatus: EnrollmentStatus;
  graduationYear: number;
  major: string | null;
  headline: string | null;
  about: string | null;
  location: string | null;
  skills: string[];
  openTo: OpenTo[];
  avatarKey: string | null;
  coverKey: string | null;
}

/** The signed-in member's own view, including private fields. */
/** 登录者自己的视图，包含私有字段。 */
export interface MemberSelf extends MemberProfile {
  email: string;
  status: MemberStatus;
  createdAt: string;
  /** Stored role. Stays superadmin while a test identity is active. */
  /** 存在库里的身份。测试其他职位时仍是系统管理员。 */
  realRole: Role;
  /** Temporary identity for the system admin. Null means use the real role. */
  /** 系统管理员的临时测试身份。空表示用真实身份。 */
  actingRole: Role | null;
}

/** Enrollment year chosen at registration. Five years either side of today, so the list stays small. */
/** 注册时填的入学年份。只能选今年前后各五年，避免乱填。 */
export const ENROLLMENT_YEAR_SPAN = 5;

/** Calendar year in Toronto, so New Year's Day matches the campus, not UTC. */
/** 多伦多的日历年。跨年时跟校园一致，不跟 UTC。 */
export function enrollmentCalendarYear(now: Date = new Date()): number {
  return Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric' }).format(now));
}

export function enrollmentYearMin(now: Date = new Date()): number {
  return enrollmentCalendarYear(now) - ENROLLMENT_YEAR_SPAN;
}

export function enrollmentYearMax(now: Date = new Date()): number {
  return enrollmentCalendarYear(now) + ENROLLMENT_YEAR_SPAN;
}

export function isValidEnrollmentYear(year: number, now: Date = new Date()): boolean {
  return Number.isInteger(year) && year >= enrollmentYearMin(now) && year <= enrollmentYearMax(now);
}

/** Five years after the enrollment year, a student is recorded as an alumnus. */
/** 入学满五年，在校生记为毕业生。 */
export function shouldGraduate(enrollmentYear: number, status: EnrollmentStatus, now: Date = new Date()): boolean {
  return status === 'student' && enrollmentCalendarYear(now) - enrollmentYear >= 5;
}

/** Years a system admin may write when correcting a registration. Wider than the self-serve picker. */
/** 系统管理员更正入学年份时可用的范围，比注册时的选项更宽。 */
export const ADMIN_ENROLLMENT_YEAR_MIN = 1990;

export function isValidAdminEnrollmentYear(year: number, now: Date = new Date()): boolean {
  return Number.isInteger(year) && year >= ADMIN_ENROLLMENT_YEAR_MIN && year <= enrollmentYearMax(now);
}

export function enrollmentYearLabel(year: number): string {
  return `${year} 年入学`;
}

export const DISPLAY_NAME_MIN = 2;
export const DISPLAY_NAME_MAX = 40;

export function isValidDisplayName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length >= DISPLAY_NAME_MIN && trimmed.length <= DISPLAY_NAME_MAX;
}

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

export function isValidPassword(password: string): boolean {
  return password.length >= PASSWORD_MIN && password.length <= PASSWORD_MAX;
}
