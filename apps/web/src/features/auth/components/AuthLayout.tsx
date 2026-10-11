import type { ReactNode } from 'react';

const logo = `${import.meta.env.BASE_URL}brand/logo.svg`;

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col px-6 pb-12 pt-12">
      <img src={logo} alt="UTMMSC" className="h-auto w-48" />
      <h1 className="mt-10 text-[26px] font-semibold tracking-tight text-brand-800">{title}</h1>
      {subtitle ? <p className="mt-1 text-sm text-brand-700">{subtitle}</p> : null}
      <div className="mt-6">{children}</div>
    </div>
  );
}
