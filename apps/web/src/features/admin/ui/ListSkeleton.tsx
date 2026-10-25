import { useTr } from '../../../shared/i18n/locale';
import { useInsetGroups } from '../layout/media';

const BLOCK = 'animate-pulse rounded bg-stone-200 motion-reduce:animate-none';

/**
 * Placeholder rows at the height of the real ones, for a first load: no layout jump when the data lands and never a
 * false 还没有… empty state. `avatar` matches member rows (64px), otherwise section cells (56px).
 * 首次加载时与真实行等高的占位行：数据到达时不会跳动，也不会误显示「还没有…」的空状态。`avatar` 对应成员行（64px），否则对应板块单元格（56px）。
 */
export function ListSkeleton({ rows = 5, avatar = false }: { rows?: number; avatar?: boolean }) {
  const tr = useTr();
  const insetGroups = useInsetGroups();
  const widths = ['w-2/5', 'w-1/3', 'w-1/2', 'w-1/4', 'w-2/5', 'w-1/3'];
  return (
    <div role="status" aria-label={tr('加载中', 'Loading')} className={`bg-white ${insetGroups ? 'overflow-hidden rounded-xl ring-1 ring-black/[0.06]' : 'mt-2'}`}>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className={`flex items-center gap-3 px-4 ${avatar ? 'h-16' : 'h-14'} ${index > 0 ? 'border-t-[0.5px] border-wx-line' : ''}`}>
          {avatar ? <span className={`h-10 w-10 shrink-0 rounded-[4px] ${BLOCK}`} /> : null}
          <span className="min-w-0 flex-1 space-y-2">
            <span className={`block h-3.5 ${widths[index % widths.length]} ${BLOCK}`} />
            {avatar ? <span className={`block h-3 w-3/5 ${BLOCK} bg-stone-100`} /> : null}
          </span>
        </div>
      ))}
    </div>
  );
}
