export function InitialAvatar({ name, className = '' }: { name: string; className?: string }) {
  return (
    <div className={`flex shrink-0 items-center justify-center rounded-full bg-brand-50 font-semibold text-brand-800 ${className}`}>
      {name.slice(0, 1)}
    </div>
  );
}
