import type { HTMLAttributes, ReactNode } from 'react';

export function Card({ className = '', children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={`rounded-xl bg-white p-4 ring-1 ring-stone-200 ${className}`}>
      {children}
    </div>
  );
}

/** Full-width rows with hairlines. The page gray shows between groups, like a WeChat list. */
/** 通栏一行一行，组与组之间露出页面的浅灰，和微信列表一样。 */
export function List({ children }: { children: ReactNode }) {
  return <div className="-mx-4 divide-y divide-stone-200 bg-white">{children}</div>;
}

export function PageTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4">
      <div className="flex items-end justify-between gap-3">
        <h1 className="text-[22px] font-semibold tracking-tight text-brand-800">{children}</h1>
        {action}
      </div>
      <span className="mt-2 block h-[3px] w-10 bg-gold" />
    </div>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'error' | 'success'; children: ReactNode }) {
  const styles = {
    info: 'bg-stone-100 text-stone-700',
    error: 'bg-red-50 text-red-800',
    success: 'bg-emerald-50 text-emerald-800',
  }[tone];
  return <div className={`rounded-lg px-3 py-2.5 text-sm leading-relaxed ${styles}`}>{children}</div>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="px-1 py-8 text-center text-sm leading-relaxed text-stone-500">{children}</p>;
}

export function Spinner() {
  return (
    <div className="flex justify-center py-10">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-stone-300 border-t-brand-800" />
    </div>
  );
}

export function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'brand' | 'green' | 'amber' }) {
  const styles = {
    slate: 'bg-stone-100 text-stone-600',
    brand: 'bg-brand-50 text-brand-800',
    green: 'bg-emerald-50 text-emerald-800',
    amber: 'bg-amber-50 text-amber-800',
  }[tone];
  return <span className={`inline-block rounded px-1.5 py-0.5 text-xs ${styles}`}>{children}</span>;
}
