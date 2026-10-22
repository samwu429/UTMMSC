/** iOS-style toggle in the brand colour. Label it with `labelledBy` or `label`. */
/** 品牌色的 iOS 式开关。用 `labelledBy` 或 `label` 为其命名。 */
export function Switch({ checked, onChange, labelledBy, label }: { checked: boolean; onChange: (next: boolean) => void; labelledBy?: string; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-[31px] w-[51px] shrink-0 items-center rounded-full transition-colors motion-reduce:transition-none ${checked ? 'bg-brand-700' : 'bg-stone-300'}`}
    >
      <span
        aria-hidden
        className={`absolute left-[2px] h-[27px] w-[27px] rounded-full bg-white shadow transition-transform motion-reduce:transition-none ${checked ? 'translate-x-5' : 'translate-x-0'}`}
      />
    </button>
  );
}
