import type { ReactNode } from 'react';

const logo = `${import.meta.env.BASE_URL}brand/logo.svg`;

export function AuthLayout({
  title,
  subtitle,
  children,
  centered = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  centered?: boolean;
}) {
  return (
    <div className={`mx-auto flex min-h-full w-full max-w-md flex-col bg-white px-7 pb-12 ${centered ? 'justify-center py-12' : 'pt-12'}`}>
      <img src={logo} alt="UTMMSC" className={`h-auto ${centered ? 'mx-auto w-64' : 'w-48'}`} />
      <h1 className={`text-[28px] font-semibold tracking-tight text-brand-800 ${centered ? 'mt-10 text-center' : 'mt-10'}`}>{title}</h1>
      {subtitle ? <p className={`mt-1 text-sm text-brand-700 ${centered ? 'text-center' : ''}`}>{subtitle}</p> : null}
      <div className={centered ? 'mt-8' : 'mt-6'}>{children}</div>
    </div>
  );
}
