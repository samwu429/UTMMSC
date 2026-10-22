import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import { useTr } from '../i18n/locale';
import { Button } from './Button';
import { useBackToClose } from './overlayHistory';

interface ConfirmRequest {
  title: string;
  body?: string;
  confirmLabel?: string;
  /** Null leaves only the confirm button, for a plain notice. */
  /** 为 null 时只保留确认按钮，用作单纯的提示。 */
  cancelLabel?: string | null;
  danger?: boolean;
}

const ConfirmContext = createContext<(request: ConfirmRequest) => Promise<boolean>>(async () => false);

export function useConfirm() {
  return useContext(ConfirmContext);
}

/** One confirmation sheet for the whole app, so deletes and sign-out never use the browser dialog. */
/** 全站只用这一块确认层，删除和退出不再弹出浏览器对话框。 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);
  const tr = useTr();

  function ask(next: ConfirmRequest) {
    resolver.current?.(false);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setRequest(next);
    });
  }

  function finish(value: boolean) {
    resolver.current?.(value);
    resolver.current = null;
    setRequest(null);
  }

  // The system back gesture cancels, as a tap outside does, instead of leaving the page.
  // 系统返回手势与点按外部一样表示取消，而不是离开页面。
  useBackToClose(() => finish(false), request !== null);

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      {request ? (
        <div className="fixed inset-0 z-[70] flex items-end bg-black/40" onClick={() => finish(false)}>
          <div
            className="w-full rounded-t-2xl bg-white px-4 pt-3"
            style={{ paddingBottom: 'max(1.25rem, var(--safe-bottom))' }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-stone-200" />
            <h2 className="text-[17px] font-semibold text-brand-800">{request.title}</h2>
            {request.body ? <p className="mt-2 text-sm leading-relaxed text-stone-600">{request.body}</p> : null}
            <div className={`mt-4 grid gap-2 ${request.cancelLabel === null ? 'grid-cols-1' : 'grid-cols-2'}`}>
              {request.cancelLabel === null ? null : (
                <Button variant="secondary" onClick={() => finish(false)}>
                  {request.cancelLabel ?? tr('取消', 'Cancel')}
                </Button>
              )}
              <Button variant={request.danger ? 'danger' : 'primary'} onClick={() => finish(true)}>
                {request.confirmLabel ?? tr('确定', 'OK')}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </ConfirmContext.Provider>
  );
}
