import type { ReactNode } from 'react';

/** A bottom sheet for editing one profile section at a time. */
/** 从底部升起的编辑层，一次只改资料里的一块。 */
export function Sheet({ title, closeLabel = '取消', onClose, children }: { title: string; closeLabel?: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={onClose}>
      <div
        className="max-h-[88vh] w-full overflow-y-auto rounded-t-2xl bg-white px-4 pt-3"
        style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-stone-200" />
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[17px] font-semibold text-brand-800">{title}</h2>
          <button type="button" onClick={onClose} className="min-h-11 px-1 text-[15px] text-stone-500">
            {closeLabel}
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
