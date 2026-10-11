import type { HTMLAttributes, ReactNode } from 'react';

export function Card({ className = '', children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={`rounded-2xl bg-white p-4 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

export function PageTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <h1 className="text-2xl font-semibold text-slate-900">{children}</h1>
      {action}
    </div>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'error' | 'success'; children: ReactNode }) {
  const styles = {
    info: 'bg-brand-50 text-brand-800',
    error: 'bg-red-50 text-red-700',
    success: 'bg-emerald-50 text-emerald-700',
  }[tone];
  return <div className={`rounded-xl px-4 py-3 text-sm ${styles}`}>{children}</div>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">{children}</div>;
}

export function Spinner() {
  return (
    <div className="flex justify-center py-10">
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
    </div>
  );
}

export function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'brand' | 'green' | 'amber' }) {
  const styles = {
    slate: 'bg-slate-100 text-slate-700',
    brand: 'bg-brand-100 text-brand-800',
    green: 'bg-emerald-100 text-emerald-800',
    amber: 'bg-amber-100 text-amber-800',
  }[tone];
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${styles}`}>{children}</span>;
}
