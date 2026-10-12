import type { ReactNode } from 'react';
import { useLocaleStore } from '../../../shared/i18n/locale';

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
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);
  return (
    <div className={`mx-auto flex min-h-full w-full max-w-md flex-col bg-white px-7 pb-12 ${centered ? 'justify-center py-12' : 'pt-12'}`}>
      <div className="mb-4 flex justify-end gap-4 text-sm">
        <button type="button" onClick={() => setLocale('zh')} className={locale === 'zh' ? 'font-medium text-brand-800' : 'text-stone-400'}>
          中文
        </button>
        <button type="button" onClick={() => setLocale('en')} className={locale === 'en' ? 'font-medium text-brand-800' : 'text-stone-400'}>
          English
        </button>
      </div>
      <img src={logo} alt="UTMMSC" className={`h-auto ${centered ? 'mx-auto w-64' : 'w-48'}`} />
      <h1 className={`text-[28px] font-semibold tracking-tight text-brand-800 ${centered ? 'mt-10 text-center' : 'mt-10'}`}>{title}</h1>
      {subtitle ? <p className={`mt-1 text-sm text-brand-700 ${centered ? 'text-center' : ''}`}>{subtitle}</p> : null}
      <div className={centered ? 'mt-8' : 'mt-6'}>{children}</div>
    </div>
  );
}
