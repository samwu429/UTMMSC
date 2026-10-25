import type { ReactNode } from 'react';
import { errorMessage } from '../../../shared/api/errors';
import { useTr } from '../../../shared/i18n/locale';
import { useInsetGroups } from '../layout/media';

/**
 * A load failure next to the area that failed: 加载失败 with the server's reason and 重试. Data loaded earlier stays
 * on screen above or below it.
 * 显示在加载失败区域旁边：「加载失败」、服务器给出的原因和「重试」。之前已加载的数据仍显示在它的上方或下方。
 */
export function LoadFailed({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const tr = useTr();
  const insetGroups = useInsetGroups();
  return (
    <div role="alert" className={`flex items-center gap-3 rounded-lg bg-red-50 py-1.5 pl-3 pr-1.5 text-red-800 ${insetGroups ? 'mt-3' : 'mx-4 mt-3'}`}>
      <span className="min-w-0 flex-1 text-[14px] leading-snug">
        <span className="font-medium">{tr('加载失败', "Couldn't load")}</span>
        <span className="block text-[13px] text-red-700">{errorMessage(error)}</span>
      </span>
      <button type="button" onClick={onRetry} className="min-h-11 shrink-0 rounded-md px-3 text-[15px] font-medium text-red-800 active:bg-red-100">
        {tr('重试', 'Retry')}
      </button>
    </div>
  );
}

/** One sentence, an optional second line, and the main action when the role may take it. */
/** 一句话、可选的第二行，以及该身份可以执行时的主要操作。 */
export function EmptyBlock({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-8 py-14 text-center">
      <p className="text-[15px] text-stone-600">{title}</p>
      {hint ? <p className="mt-2 max-w-sm text-[13px] leading-relaxed text-wx-meta">{hint}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
