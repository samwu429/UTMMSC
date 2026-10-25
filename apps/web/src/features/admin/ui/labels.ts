import { ROLES, type Role } from '@utmmsc/shared';
import { useLabels, type Locale } from '../../../shared/i18n/locale';

/**
 * Role names in the site language, as one object per language. The same object comes back until the language
 * changes, so long lists can memoise on it (useLabels hands out new functions every render).
 * 网站语言下的身份名称，每种语言一个对象。在语言改变之前返回的始终是同一个对象，长列表因此可以据此做记忆化（useLabels 每次渲染都返回新函数）。
 */
const namesByLocale = new Map<Locale, Readonly<Record<Role, string>>>();

export function useRoleNames(): Readonly<Record<Role, string>> {
  const { locale, role } = useLabels();
  let names = namesByLocale.get(locale);
  if (!names) {
    names = Object.fromEntries(ROLES.map((value) => [value, role(value)])) as Record<Role, string>;
    namesByLocale.set(locale, names);
  }
  return names;
}

/** A day in the site language, such as 2026年10月24日 or Oct 24, 2026. */
/** 网站语言下的日期，例如「2026年10月24日」或「Oct 24, 2026」。 */
export function formatDay(iso: string, locale: Locale): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-CA' : 'zh-CN', { year: 'numeric', month: locale === 'en' ? 'short' : 'long', day: 'numeric' }).format(date);
}

/** A day and time in the site language, for 提交时间. */
/** 网站语言下的日期和时间，用于「提交时间」。 */
export function formatDayTime(iso: string, locale: Locale): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-CA' : 'zh-CN', {
    year: 'numeric',
    month: locale === 'en' ? 'short' : 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}
