import { PROGRAM_LEVELS, UTM_PROGRAMS_BY_CODE, programOptionLabel, type UtmProgram } from './catalog';

/**
 * UTM honours / Subject POSt enrolment.
 *
 * https://utm.calendar.utoronto.ca/program-selection
 * "Students must enrol in the appropriate program, or combination of programs in the session in which they have completed, or will complete, 4.0 credits. All degree students must enrol in at least one specialist, two majors, or one major and two minors. A maximum of 3 programs are allowed as long as one is a minor."
 *
 * https://utm.calendar.utoronto.ca/honours-bachelor-arts-hba
 * (the same cap is restated at https://utm.calendar.utoronto.ca/honours-bachelor-science-hbsc)
 * "No more than three programs may be listed on ACORN under the “Currently Enrolled” section, with no more than two Specialists or two Majors. Students who wish to combine programs must adhere to one of the appropriate combinations listed above."
 * "it is not permissible to complete more than one program type (Specialist, Major, Minor) containing the same final four-digit program code."
 *
 * Finished sets are therefore one specialist, two majors, or one major plus two minors.
 * A minor may be added until the cap of three (specialist plus minor, specialist plus two minors, two majors plus one minor).
 * A specialist is not combined with a major, and two specialists are not a listed combination.
 * Before 4.0 credits a student may have no program yet. That empty choice cannot be combined with a program.
 */
export const UNDECLARED_PROGRAM = 'UNDECLARED';

/** New selections are stored in the existing major column. Old free text has no prefix and stays readable. */
export const PROGRAM_MAJOR_PREFIX = 'utm:';

/** Three long program names plus their codes. The column is TEXT; this only caps the API. */
export const PROGRAM_MAJOR_MAX = 240;

export const PROGRAM_RULE_SUMMARY =
  '读满 4.0 学分后要选定项目。完整组合是一个专业方向，或两个主修，或一个主修加两个辅修。最多三个项目，且选满三个时必须包含一个辅修，因此还可以是专业方向加辅修，或两个主修加一个辅修。专业方向不能和主修叠在一起，也不能选两个专业方向。不能只选辅修，不能重复，同一编号的专业方向、主修和辅修也不能一起选。一年级还没选项目时，请选「尚未选择专业」，它不能和其他项目一起选。';

function subjectCode(code: string): string {
  return code.slice(-4);
}

/** Null when the codes are a finished selection, including “no program yet”. */
export function programSelectionError(codes: readonly string[]): string | null {
  if (codes.includes(UNDECLARED_PROGRAM)) {
    return codes.length === 1 ? null : '尚未选择专业不能和其他项目一起选';
  }
  if (codes.length === 0) return null;
  if (new Set(codes).size !== codes.length) return '同一项目不能重复选择';

  const programs: UtmProgram[] = [];
  for (const code of codes) {
    const program = UTM_PROGRAMS_BY_CODE.get(code);
    if (!program) return '有无法识别的项目';
    programs.push(program);
  }

  if (new Set(programs.map((program) => subjectCode(program.code))).size !== programs.length) {
    return '同一编号的专业方向、主修和辅修不能同时选择';
  }

  const specialists = programs.filter((program) => program.level === 'specialist').length;
  const majors = programs.filter((program) => program.level === 'major').length;
  const minors = programs.filter((program) => program.level === 'minor').length;

  if (specialists > 2) return '专业方向最多两个';
  if (majors > 2) return '主修最多两个';
  if (specialists + majors + minors > 3) return '最多选择三个项目';

  const legal =
    (specialists === 1 && majors === 0 && minors <= 2) ||
    (specialists === 0 && majors === 2 && minors <= 1) ||
    (specialists === 0 && majors === 1 && minors === 2);
  if (legal) return null;

  if (specialists === 0 && majors === 0) return '只选辅修不能作为完整组合';
  if (specialists > 0 && majors > 0) return '专业方向不能和主修组合';
  if (specialists >= 2) return '两个专业方向不能作为完整组合';
  if (majors === 1) return '一个主修需要再加一个主修，或配两个辅修';
  return '这个组合不符合校历';
}

/** Canonical major text, or null for “尚未选择专业”. Invalid selections return null. */
export function encodeProgramSelection(codes: readonly string[]): string | null {
  if (programSelectionError(codes)) return null;
  const real = codes.filter((code) => code !== UNDECLARED_PROGRAM);
  if (real.length === 0) return null;
  const sorted = [...real].sort();
  const names = sorted.map((code) => UTM_PROGRAMS_BY_CODE.get(code)?.name ?? code);
  return `${PROGRAM_MAJOR_PREFIX}${sorted.join(',')} ${names.join(' | ')}`;
}

const STORED_CODES = /^utm:([A-Z0-9,]+)(?:\s|$)/;

export function readStoredProgramCodes(
  stored: string | null | undefined,
): { kind: 'empty' } | { kind: 'legacy'; text: string } | { kind: 'programs'; codes: string[] } {
  if (!stored || !stored.trim()) return { kind: 'empty' };
  const match = STORED_CODES.exec(stored.trim());
  if (!match?.[1]) return { kind: 'legacy', text: stored.trim() };
  const codes = match[1].split(',').filter(Boolean);
  if (codes.length === 0 || codes.some((code) => !UTM_PROGRAMS_BY_CODE.has(code))) {
    return { kind: 'legacy', text: stored.trim() };
  }
  return { kind: 'programs', codes };
}

/** Chinese labels for a new selection. Old free-text majors are returned unchanged. */
export function formatStoredMajor(stored: string | null | undefined): string | null {
  const parsed = readStoredProgramCodes(stored);
  if (parsed.kind === 'empty') return null;
  if (parsed.kind === 'legacy') return parsed.text;
  return parsed.codes
    .map((code) => UTM_PROGRAMS_BY_CODE.get(code))
    .filter((program): program is UtmProgram => Boolean(program))
    .sort((a, b) => PROGRAM_LEVELS.indexOf(a.level) - PROGRAM_LEVELS.indexOf(b.level) || a.name.localeCompare(b.name))
    .map((program) => programOptionLabel(program))
    .join('、');
}

export function canonicalizeProgramMajor(
  value: string | null,
): { ok: true; major: string | null } | { ok: false; message: string } {
  if (value === null || value.trim() === '') return { ok: true, major: null };
  const match = STORED_CODES.exec(value.trim());
  if (!match?.[1]) return { ok: false, message: '请从列表中选择项目' };
  const codes = match[1].split(',').filter(Boolean);
  const message = programSelectionError(codes);
  if (message) return { ok: false, message };
  const major = encodeProgramSelection(codes);
  if (major && major.length > PROGRAM_MAJOR_MAX) return { ok: false, message: '专业过长' };
  return { ok: true, major };
}

/** `null` means the form has not chosen yet. An empty list is “尚未选择专业”. */
export function programChoiceState(programs: readonly string[] | null): { ready: boolean; message: string } {
  if (programs === null) return { ready: false, message: '请选择「尚未选择专业」，或组成符合校历的项目' };
  const message = programSelectionError(programs);
  if (message) return { ready: false, message };
  if (programs.length === 0 || (programs.length === 1 && programs[0] === UNDECLARED_PROGRAM)) {
    return { ready: true, message: '已选：尚未选择专业' };
  }
  return { ready: true, message: '这个组合可以提交' };
}
