export function UnreadDot({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="min-w-[20px] rounded-full bg-accent-400 px-1.5 py-0.5 text-center text-xs font-semibold text-brand-900">{count > 99 ? '99+' : count}</span>
  );
}
