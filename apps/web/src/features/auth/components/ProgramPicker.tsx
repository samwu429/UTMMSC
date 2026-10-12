import { useState } from 'react';
import {
  PROGRAM_LEVELS,
  UTM_DEPARTMENTS,
  UTM_PROGRAMS_BY_CODE,
  programChoiceState,
  programOptionLabel,
  programsInDepartment,
  PROGRAM_RULE_SUMMARY,
} from '@utmmsc/shared';

export function ProgramPicker({
  programs,
  onChange,
  legacyMajor,
}: {
  programs: string[] | null;
  onChange: (next: string[] | null) => void;
  legacyMajor?: string | null;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const undeclared = programs !== null && programs.length === 0;
  const state = programChoiceState(programs);
  const selected = new Set(programs ?? []);

  function toggle(code: string) {
    if (undeclared) return;
    if (selected.has(code)) {
      const next = (programs ?? []).filter((item) => item !== code);
      onChange(next.length === 0 ? null : next);
      return;
    }
    onChange([...(programs ?? []), code]);
  }

  return (
    <div className="space-y-2">
      <p className="text-[13px] font-medium text-stone-600">专业</p>
      <p className="text-xs leading-relaxed text-stone-500">专业可以随时更改。{PROGRAM_RULE_SUMMARY}</p>
      {legacyMajor ? <p className="text-xs leading-relaxed text-stone-600">当前记录：{legacyMajor}。重新选择并保存后会替换它。</p> : null}

      {programs && programs.length > 0 ? (
        <ul className="divide-y divide-stone-200 overflow-hidden rounded-lg bg-white ring-1 ring-stone-200">
          {programs.map((code) => (
            <li key={code} className="flex items-center gap-3 px-3 py-2.5">
              <span className="min-w-0 flex-1 text-sm leading-snug text-brand-800">{labelFor(code)}</span>
              <button type="button" className="shrink-0 text-sm text-stone-500" onClick={() => toggle(code)}>
                移除
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <label className="flex min-h-12 items-center gap-3 rounded-lg bg-white px-3 ring-1 ring-stone-200">
        <input
          id="program-undeclared"
          type="checkbox"
          className="h-4 w-4 accent-brand-800"
          checked={undeclared}
          onChange={(event) => {
            setOpenId(null);
            onChange(event.target.checked ? [] : null);
          }}
        />
        <span className="text-[15px] text-stone-800">尚未选择专业</span>
      </label>

      <div className={`overflow-hidden rounded-lg bg-white ring-1 ring-stone-200 ${undeclared ? 'pointer-events-none opacity-40' : ''}`}>
        {UTM_DEPARTMENTS.map((department) => {
          const items = programsInDepartment(department.id);
          if (items.length === 0) return null;
          const open = openId === department.id;
          const picked = items.filter((program) => selected.has(program.code)).length;
          return (
            <div key={department.id} className="border-b border-stone-200 last:border-b-0">
              <button
                type="button"
                aria-expanded={open}
                className="flex min-h-12 w-full items-center gap-3 px-3 py-2.5 text-left active:bg-stone-50"
                onClick={() => setOpenId(open ? null : department.id)}
              >
                <span className="min-w-0 flex-1 text-[15px] leading-snug text-brand-800">{department.name}</span>
                {picked > 0 ? <span className="shrink-0 text-xs font-medium text-brand-700">{picked}</span> : null}
                <span className={`shrink-0 text-stone-400 transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden>
                  ›
                </span>
              </button>
              {open ? (
                <div className="border-t border-stone-100 bg-stone-50">
                  {PROGRAM_LEVELS.map((level) => {
                    const group = items.filter((program) => program.level === level);
                    if (group.length === 0) return null;
                    return (
                      <div key={level}>
                        <p className="px-3 pt-2 text-[11px] font-medium text-stone-400">{level}</p>
                        {group.map((program) => {
                          const on = selected.has(program.code);
                          return (
                            <button
                              key={program.code}
                              type="button"
                              aria-pressed={on}
                              className="flex min-h-11 w-full items-center gap-3 px-3 py-2 text-left active:bg-stone-100"
                              onClick={() => toggle(program.code)}
                            >
                              <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? 'border-brand-800 bg-brand-800 text-white' : 'border-stone-300 bg-white'}`}>
                                {on ? <span className="text-[10px] leading-none">✓</span> : null}
                              </span>
                              <span className="min-w-0 flex-1 text-[15px] leading-snug text-stone-900">{program.name}</span>
                              {program.area ? <span className="shrink-0 text-xs text-stone-400">{program.area}</span> : null}
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <p id="program-choice-status" data-program-ready={state.ready ? 'yes' : 'no'} className={`text-xs leading-relaxed ${state.ready ? 'text-brand-800' : 'text-red-700'}`}>
        {state.message}
      </p>
    </div>
  );
}

function labelFor(code: string): string {
  const program = UTM_PROGRAMS_BY_CODE.get(code);
  return program ? programOptionLabel(program) : code;
}
