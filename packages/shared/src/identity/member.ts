import type { OpenTo } from './profile';
import type { Role } from './roles';

export const ENROLLMENT_STATUSES = ['student', 'alumni'] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

export const ENROLLMENT_LABELS: Record<EnrollmentStatus, string> = {
  student: '在校',
  alumni: '已毕业',
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

export const GRADUATION_YEAR_MIN = 1960;

export function graduationYearMax(now: Date = new Date()): number {
  return now.getFullYear() + 8;
}

export function isValidGraduationYear(year: number, now: Date = new Date()): boolean {
  return Number.isInteger(year) && year >= GRADUATION_YEAR_MIN && year <= graduationYearMax(now);
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
