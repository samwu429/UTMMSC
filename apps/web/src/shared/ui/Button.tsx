import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const STYLES: Record<Variant, string> = {
  primary: 'bg-brand-700 text-white hover:bg-brand-800 active:bg-brand-900 disabled:bg-brand-500/50',
  secondary: 'bg-white text-brand-900 border border-brand-100 hover:bg-brand-50 active:bg-brand-100 disabled:text-slate-400',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-400',
  ghost: 'bg-transparent text-brand-700 hover:bg-brand-50 disabled:text-slate-400',
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  block?: boolean;
  loading?: boolean;
}

export function Button({ variant = 'primary', block, loading, className = '', children, disabled, ...rest }: Props) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 py-3 text-base font-medium transition active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100 ${STYLES[variant]} ${block ? 'w-full' : ''} ${className}`}
    >
      {loading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : null}
      {children}
    </button>
  );
}
