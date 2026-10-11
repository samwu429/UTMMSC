import type { ReactNode } from 'react';

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col px-6 pb-10 pt-14">
      <p className="text-sm font-semibold tracking-wide text-brand-800">UTMMSC</p>
      <h1 className="mt-3 text-[28px] font-semibold tracking-tight">{title}</h1>
      {subtitle ? <p className="mt-1 text-sm text-stone-500">{subtitle}</p> : null}
      <div className="mt-8">{children}</div>
    </div>
  );
}
