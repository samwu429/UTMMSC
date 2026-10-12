import { UTM_DEPARTMENTS, UTM_PROGRAMS_BY_CODE, programOptionLabel, programsInDepartment, PROGRAM_RULE_SUMMARY, programChoiceState } from '@utmmsc/shared';

export function ProgramPicker({
  programs,
  onChange,
  legacyMajor,
}: {
  programs: string[] | null;
  onChange: (next: string[] | null) => void;
  legacyMajor?: string | null;
}) {
  const undeclared = programs !== null && programs.length === 0;
  const state = programChoiceState(programs);
  const selected = new Set(programs ?? []);

  function add(code: string) {
    if (!code || selected.has(code)) return;
    onChange([...(programs ?? []), code]);
  }

  return (
    <div className="space-y-2">
      <p className="text-[13px] font-medium text-stone-600">专业</p>
      <p className="text-xs leading-relaxed text-stone-500">{PROGRAM_RULE_SUMMARY}</p>
      {legacyMajor ? <p className="text-xs leading-relaxed text-stone-600">当前记录：{legacyMajor}。重新选择并保存后会替换它。</p> : null}
      <label className="flex items-center gap-2 text-sm text-stone-800">
        <input
          id="program-undeclared"
          type="checkbox"
          className="h-4 w-4 accent-brand-800"
          checked={undeclared}
          onChange={(event) => onChange(event.target.checked ? [] : null)}
        />
        尚未选择专业
      </label>
      <select
        id="program-add"
        aria-label="添加项目"
        className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-stone-900 outline-none focus:border-brand-800 focus:ring-2 focus:ring-brand-100 disabled:bg-stone-100"
        value=""
        disabled={undeclared}
        onChange={(event) => add(event.target.value)}
      >
        <option value="">按院系添加项目</option>
        {UTM_DEPARTMENTS.map((department) => {
          const items = programsInDepartment(department.id);
          if (items.length === 0) return null;
          return (
            <optgroup key={department.id} label={`${department.nameZh} · ${department.name}`}>
              {items.map((program) => (
                <option key={`${department.id}-${program.code}`} value={program.code} disabled={selected.has(program.code)}>
                  {programOptionLabel(program)}
                </option>
              ))}
            </optgroup>
          );
        })}
      </select>
      {programs && programs.length > 0 ? (
        <ul className="space-y-1">
          {programs.map((code) => (
            <li key={code} className="flex items-center justify-between gap-2 rounded-lg bg-stone-50 px-3 py-2 text-sm">
              <span>{labelFor(code)}</span>
              <button type="button" className="shrink-0 text-stone-500" onClick={() => onChange(programs.filter((item) => item !== code))}>
                移除
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <p id="program-choice-status" data-program-ready={state.ready ? 'yes' : 'no'} className={`text-xs leading-relaxed ${state.ready ? 'text-brand-800' : 'text-red-700'}`}>
        {state.message}
      </p>
      <p className="text-xs text-stone-400">专业方向、主修、辅修分别对应 Specialist、Major、Minor。</p>
    </div>
  );
}

function labelFor(code: string): string {
  const program = UTM_PROGRAMS_BY_CODE.get(code);
  return program ? programOptionLabel(program) : code;
}
