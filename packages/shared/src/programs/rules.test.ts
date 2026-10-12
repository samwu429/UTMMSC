import { describe, expect, it } from 'vitest';
import { UTM_DEPARTMENTS, UTM_PROGRAMS, programsInDepartment } from './catalog';
import {
  canonicalizeProgramMajor,
  encodeProgramSelection,
  formatStoredMajor,
  programSelectionError,
  UNDECLARED_PROGRAM,
} from './rules';

const CS_SPECIALIST = 'ERSPE1688';
const CS_MAJOR = 'ERMAJ1688';
const CS_MINOR = 'ERMIN1688';
const ECO_MAJOR = 'ERMAJ1478';
const ECO_MINOR = 'ERMIN1478';
const PSY_MINOR = 'ERMIN1160';
const PSY_SPECIALIST = 'ERSPE1160';

describe('UTM program catalog', () => {
  it('imports every calendar specialist, major, and minor under its department', () => {
    expect(UTM_DEPARTMENTS).toHaveLength(18);
    expect(UTM_PROGRAMS).toHaveLength(155);
    expect(new Set(UTM_PROGRAMS.map((program) => program.code)).size).toBe(155);
    for (const program of UTM_PROGRAMS) {
      expect(program.code).toMatch(/^ER(SPE|MAJ|MIN)\d{4}$/);
      const prefix = program.code.slice(2, 5);
      expect(prefix === 'SPE' ? 'specialist' : prefix === 'MAJ' ? 'major' : 'minor').toBe(program.level);
    }
    expect(programsInDepartment('economics').some((program) => program.code === 'ERSPE0751')).toBe(true);
    expect(programsInDepartment('political-science').some((program) => program.code === 'ERSPE0751')).toBe(true);
    expect(programsInDepartment('political-science').some((program) => program.code === 'ERSPE1045')).toBe(true);
  });
});

describe('program combination rules', () => {
  it('accepts the calendar combinations, including a minor added under the cap', () => {
    expect(programSelectionError([])).toBeNull();
    expect(programSelectionError([UNDECLARED_PROGRAM])).toBeNull();
    expect(programSelectionError([CS_SPECIALIST])).toBeNull();
    expect(programSelectionError([CS_SPECIALIST, PSY_MINOR])).toBeNull();
    expect(programSelectionError([CS_SPECIALIST, PSY_MINOR, ECO_MINOR])).toBeNull();
    expect(programSelectionError([CS_MAJOR, ECO_MAJOR])).toBeNull();
    expect(programSelectionError([CS_MAJOR, ECO_MAJOR, PSY_MINOR])).toBeNull();
    expect(programSelectionError([CS_MAJOR, PSY_MINOR, ECO_MINOR])).toBeNull();
  });

  it('rejects a lone minor, only minors, duplicates, and other illegal mixes', () => {
    expect(programSelectionError([PSY_MINOR])).toBe('只选 minor 不能作为完整组合');
    expect(programSelectionError([PSY_MINOR, ECO_MINOR])).toBe('只选 minor 不能作为完整组合');
    expect(programSelectionError([CS_MAJOR])).toMatch(/一个 major/);
    expect(programSelectionError([CS_MAJOR, PSY_MINOR])).toMatch(/一个 major/);
    expect(programSelectionError([CS_SPECIALIST, CS_SPECIALIST])).toBe('同一项目不能重复选择');
    expect(programSelectionError([CS_SPECIALIST, ECO_MAJOR])).toBe('specialist 不能和 major 组合');
    expect(programSelectionError([CS_SPECIALIST, PSY_SPECIALIST])).toBe('两个 specialist 不能作为完整组合');
    expect(programSelectionError([CS_SPECIALIST, CS_MINOR])).toBe('同一编号的 specialist、major 和 minor 不能同时选择');
    expect(programSelectionError([UNDECLARED_PROGRAM, PSY_MINOR])).toBe('尚未选择专业不能和其他项目一起选');
    expect(programSelectionError(['ERSPE0000'])).toBe('有无法识别的项目');

    const majors = UTM_PROGRAMS.filter((program) => program.level === 'major').slice(0, 10).map((program) => program.code);
    expect(majors).toHaveLength(10);
    expect(programSelectionError(majors)).toBe('major 最多两个');
  });

  it('stores a canonical selection and still shows old free text', () => {
    const stored = encodeProgramSelection([PSY_MINOR, CS_SPECIALIST]);
    expect(stored).toBe('utm:ERMIN1160,ERSPE1688 Psychology | Computer Science');
    expect(formatStoredMajor(stored)).toBe('Computer Science · specialist · Science、Psychology · minor · Science');
    expect(formatStoredMajor('Computer Science')).toBe('Computer Science');
    expect(formatStoredMajor(null)).toBeNull();

    expect(canonicalizeProgramMajor(null)).toEqual({ ok: true, major: null });
    expect(canonicalizeProgramMajor('Computer Science')).toEqual({ ok: false, message: '请从列表中选择项目' });
    expect(canonicalizeProgramMajor('utm:ERMIN1160')).toEqual({ ok: false, message: '只选 minor 不能作为完整组合' });
    expect(canonicalizeProgramMajor('utm:ERSPE1688')).toEqual({
      ok: true,
      major: 'utm:ERSPE1688 Computer Science',
    });
  });
});
