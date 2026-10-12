import { OPEN_TO, SKILL_MAX_COUNT, SKILL_MAX_LENGTH, type OpenTo } from '@utmmsc/shared';

/** Raised for profile input that a route should turn into a 400 response. */
/** 资料输入不合法时抛出，由路由转成 400。 */
export class FieldError extends Error {}

const YEAR_MIN = 1960;

function yearMax(now: Date): number {
  return now.getFullYear() + 1;
}

function assertYear(year: number, label: string, now: Date): number {
  if (year < YEAR_MIN || year > yearMax(now)) throw new FieldError(`${label}无效`);
  return year;
}

function integer(value: unknown, label: string): number {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n)) throw new FieldError(`${label}必须是整数`);
  return n;
}

export function skillsFromInput(value: unknown): string[] {
  if (!Array.isArray(value)) throw new FieldError('技能格式错误');
  if (value.length > SKILL_MAX_COUNT) throw new FieldError(`技能最多 ${SKILL_MAX_COUNT} 项`);
  const skills: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') throw new FieldError('技能格式错误');
    const skill = item.trim();
    if (!skill) continue;
    if (skill.length > SKILL_MAX_LENGTH) throw new FieldError(`每项技能不超过 ${SKILL_MAX_LENGTH} 个字`);
    if (!skills.includes(skill)) skills.push(skill);
  }
  return skills;
}

export function openToFromInput(value: unknown): OpenTo[] {
  if (!Array.isArray(value)) throw new FieldError('正在寻找的格式错误');
  const picked: OpenTo[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !(OPEN_TO as readonly string[]).includes(item)) {
      throw new FieldError('正在寻找的选项无效');
    }
    const id = item as OpenTo;
    if (!picked.includes(id)) picked.push(id);
  }
  return picked;
}

export interface ExperienceInput {
  title: string;
  organization: string;
  startYear: number;
  endYear: number | null;
  current: boolean;
  description: string | null;
}

function text(value: unknown, label: string, max: number, required: boolean): string | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw new FieldError(`请填写${label}`);
    return null;
  }
  if (typeof value !== 'string') throw new FieldError(`${label}格式错误`);
  const trimmed = value.trim();
  if (!trimmed) {
    if (required) throw new FieldError(`请填写${label}`);
    return null;
  }
  if (trimmed.length > max) throw new FieldError(`${label}过长`);
  return trimmed;
}

/** Current roles drop the end year. A finished role needs an end year on or after the start. */
/** 仍在进行的经历不记结束年。已结束的经历需要不早于开始年的结束年。 */
export function experienceFromInput(body: Record<string, unknown>, now = new Date()): ExperienceInput {
  const title = text(body.title, '身份', 40, true);
  const organization = text(body.organization, '机构', 60, true);
  if (typeof body.current !== 'boolean') throw new FieldError('请标明是否仍在进行');
  const startYear = assertYear(integer(body.startYear, '开始年份'), '开始年份', now);
  let endYear: number | null = null;
  if (!body.current) {
    if (body.endYear === undefined || body.endYear === null || body.endYear === '') throw new FieldError('请填写结束年份');
    endYear = assertYear(integer(body.endYear, '结束年份'), '结束年份', now);
    if (endYear < startYear) throw new FieldError('结束年份不能早于开始年份');
  }
  return {
    title: title ?? '',
    organization: organization ?? '',
    startYear,
    endYear,
    current: body.current,
    description: text(body.description, '说明', 300, false),
  };
}
