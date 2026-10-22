import type { EnrollmentStatus } from './member';

/**
 * University of Toronto email domains accepted for self-service registration.
 * Addresses outside this list must go through the manual application queue.
 * 允许自助注册的多伦多大学邮箱域名。此列表之外的地址须走人工申请队列。
 */
export const ALLOWED_EMAIL_DOMAINS = [
  'mail.utoronto.ca',
  'utoronto.ca',
  'alumni.utoronto.ca',
] as const;

export type AllowedEmailDomain = (typeof ALLOWED_EMAIL_DOMAINS)[number];

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Lower-cases and trims an address so comparisons and uniqueness checks are stable. */
/** 规范化地址（小写、去空白），保证比较与唯一性检查稳定。 */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isWellFormedEmail(raw: string): boolean {
  return EMAIL_SHAPE.test(raw.trim());
}

export function emailDomainOf(raw: string): string | null {
  const normalized = normalizeEmail(raw);
  const at = normalized.lastIndexOf('@');
  if (at < 0) return null;
  return normalized.slice(at + 1);
}

/**
 * True when the address belongs to a university domain. Sub-domains such as
 * `cs.utoronto.ca` are accepted because departments issue them to students and staff.
 * 地址属于学校域名时返回 true。接受 `cs.utoronto.ca` 这类院系子域名。
 */
export function isUniversityEmail(raw: string): boolean {
  if (!isWellFormedEmail(raw)) return false;
  const domain = emailDomainOf(raw);
  if (!domain) return false;
  return ALLOWED_EMAIL_DOMAINS.some(
    (allowed) => domain === allowed || domain.endsWith(`.${allowed}`),
  );
}

/**
 * Enrollment status the address already settles. mail.utoronto.ca is issued to current students and
 * alumni.utoronto.ca to graduates. utoronto.ca and department sub-domains are rare and say nothing about
 * enrollment, so those people choose for themselves (null).
 * 邮箱地址已经决定的在读状态。mail.utoronto.ca 发给在读学生，alumni.utoronto.ca 发给毕业生。
 * utoronto.ca 及院系子域名很少见，也不能说明在读状态，由本人选择（返回 null）。
 */
export function enrollmentForEmail(raw: string): EnrollmentStatus | null {
  if (!isUniversityEmail(raw)) return null;
  const domain = emailDomainOf(raw) ?? '';
  const under = (parent: string) => domain === parent || domain.endsWith(`.${parent}`);
  if (under('mail.utoronto.ca')) return 'student';
  if (under('alumni.utoronto.ca')) return 'alumni';
  return null;
}
