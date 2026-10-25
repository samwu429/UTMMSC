/**
 * English for the admin routes' messages (/admin/*): roles, account status, enrollment corrections, year requests,
 * advisor invitations and test identities, plus the field checks those routes make.
 * Owner: A-shell, admin shell, review, members and reports. shared/api/errors.ts merges this file and is otherwise frozen.
 * 管理接口（/admin/*）提示的英文：身份、账号状态、入学信息更正、入学年份申请、荣誉顾问邀请和测试身份，以及这些接口所做的字段检查。
 * 维护者：A-shell，管理后台框架、待审核、成员与投诉。shared/api/errors.ts 合并本文件，此外不再改动。
 */
import type { EnglishPattern } from '../errors';

/** Exact server text to its English. */
/** 服务端原文到英文的对照。 */
export const ENGLISH: Readonly<Record<string, string>> = {
  '不能修改自己的身份': "You can't change your own role.",
  '不能停用自己': "You can't disable your own account.",
  '无权分配该身份': "You can't assign that role.",
  '无权修改该成员': "You can't change members at or above your level.",
  '只有系统管理员可以指定荣誉顾问': 'Only a system administrator can assign honorary advisors.',
  '只有系统管理员可以修改荣誉顾问': 'Only a system administrator can change honorary advisors.',
  '只有系统管理员可以切换测试身份': 'Only a system administrator can switch test roles.',
  '只有系统管理员可以更正入学年份': 'Only a system administrator can correct enrollment years.',
  '只有系统管理员可以查看入学年份申请': 'Only a system administrator can see enrollment year requests.',
  '只有系统管理员可以处理入学年份申请': 'Only a system administrator can decide enrollment year requests.',
  '只有系统管理员可以邀请校外荣誉顾问': 'Only a system administrator can invite external honorary advisors.',
  '校外荣誉顾问没有入学年份': "External honorary advisors don't have an enrollment year.",
};

/** The admin routes' field names, for the generic checks that embed them. */
/** 管理接口的字段名，用于包含字段名的通用检查提示。 */
const FIELDS: Readonly<Record<string, string>> = {
  '身份': 'role',
  '状态': 'account status',
  '在读状态': 'enrollment status',
  '入学年份': 'enrollment year',
  '决定': 'decision',
  '邮箱': 'email',
  '标题': 'title',
  '正文': 'message',
  '活动名称': 'event name',
  '开始时间': 'start time',
  '地点': 'location',
  '说明': 'description',
};

function field(name: string | undefined): string | null {
  return name !== undefined && Object.prototype.hasOwnProperty.call(FIELDS, name) ? (FIELDS[name] ?? null) : null;
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Server text that embeds a number or a name. Only the admin field names match; others fall through to the next map. */
/** 含数字或名称的服务端提示。只匹配管理接口的字段名；其他的交给后面的对照处理。 */
export const ENGLISH_PATTERNS: readonly EnglishPattern[] = [
  [/^(身份|状态|在读状态|决定) 取值无效$/, (m) => `That ${field(m[1]) ?? 'value'} is not valid.`],
  [/^(入学年份) 必须是整数$/, () => 'The enrollment year must be a whole number.'],
  [/^缺少 (身份|状态|在读状态|入学年份|邮箱|标题|正文|活动名称|开始时间)$/, (m) => `${capitalized(field(m[1]) ?? 'a field')} is missing.`],
  [/^(邮箱|标题|正文|活动名称|开始时间|地点|说明) 过长$/, (m) => `The ${field(m[1]) ?? 'field'} is too long.`],
];
