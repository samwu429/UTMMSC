export function UnreadDot({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="min-w-[18px] rounded-full bg-[#f5c400] px-1.5 text-center text-[11px] font-semibold leading-[18px] text-stone-900">
      {count > 99 ? '99+' : count}
    </span>
  );
}
