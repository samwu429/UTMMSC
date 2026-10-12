import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

function Chevron() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m14 6-6 6 6 6" />
    </svg>
  );
}

/** Sticky back bar. `label` is where it returns, so the control says “发现” instead of a bare arrow. */
/** 吸顶返回栏。label 是回去的地方，所以按钮写的是「发现」，不是光一个箭头。 */
export function BackHeader({
  to,
  onBack,
  label,
  title,
  trailing,
  flush = false,
}: {
  to?: string;
  onBack?: () => void;
  label: string;
  title?: string;
  trailing?: ReactNode;
  flush?: boolean;
}) {
  const navigate = useNavigate();

  function go() {
    if (onBack) onBack();
    else if (to) navigate(to);
  }

  return (
    <header className={`sticky top-0 z-20 flex min-h-12 items-center border-b border-stone-200 bg-paper ${flush ? 'px-1' : '-mx-4 mb-4 px-1'}`}>
      <button type="button" onClick={go} className="flex min-h-11 items-center gap-0.5 rounded-lg px-2 text-[16px] font-medium text-brand-800 active:bg-stone-100" aria-label={`返回${label}`}>
        <Chevron />
        {label}
      </button>
      {title ? <h1 className="pointer-events-none absolute inset-x-24 truncate text-center text-[17px] font-semibold text-brand-800">{title}</h1> : null}
      <div className="ml-auto flex min-w-11 items-center justify-end pr-2">{trailing}</div>
    </header>
  );
}
