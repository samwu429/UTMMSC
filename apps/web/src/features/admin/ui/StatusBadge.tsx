import type { ReactNode } from 'react';

/** pending: waiting (amber); ok: done or active (green); muted: neutral; danger: failed or disabled; brand: a kind. */
/** pending：等待中（琥珀色）；ok：已完成或在用（绿色）；muted：中性；danger：失败或已停用；brand：类别。 */
export type StatusTone = 'pending' | 'ok' | 'muted' | 'danger' | 'brand';

const TONES: Record<StatusTone, string> = {
  pending: 'bg-amber-50 text-amber-800',
  ok: 'bg-emerald-50 text-emerald-800',
  muted: 'bg-stone-100 text-stone-600',
  danger: 'bg-red-50 text-red-700',
  brand: 'bg-brand-50 text-brand-800',
};

/** A small status word in a row; every tone keeps its text at 4.5:1 or better. */
/** 行内的小号状态文字；每种色调的文字对比度都不低于 4.5:1。 */
export function StatusBadge({ tone = 'muted', children }: { tone?: StatusTone; children: ReactNode }) {
  return <span className={`inline-flex shrink-0 items-center whitespace-nowrap rounded px-1.5 py-0.5 text-[12px] leading-4 ${TONES[tone]}`}>{children}</span>;
}
