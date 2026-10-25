import type { ReactNode } from 'react';
import { useTr } from '../../../shared/i18n/locale';
import { AdminPaneContext, useIsWide } from './media';

/** What the detail pane shows while nothing is selected. */
/** 未选择任何项目时详情栏显示的内容。 */
export function DetailPlaceholder({ text }: { text?: string }) {
  const tr = useTr();
  return (
    <div className="flex min-h-[100dvh] items-center justify-center px-8 text-center text-[15px] text-wx-meta">
      {text ?? tr('选择一项查看详情', 'Select an item to see details')}
    </div>
  );
}

/**
 * A list section with its item screens. From 1280px the list and the selected item sit side by side, and the list
 * keeps its own scroll. Narrower, the item replaces the list, which stays mounted but hidden, so going back is
 * instant and keeps the search, the filters and the scroll position (the layout restores it). Selection is part of
 * the address, so `detailOpen` comes from the route.
 * 带项目界面的列表板块。从 1280px 起列表和所选项目并排显示，列表有自己的滚动。更窄时项目界面取代列表，列表仍保持挂载但被隐藏，
 * 因此返回是即时的，并保留搜索、筛选和滚动位置（由布局恢复）。所选项目是地址的一部分，所以 `detailOpen` 来自路由。
 */
export function SplitView({ list, detail, detailOpen, placeholder }: { list: ReactNode; detail: ReactNode; detailOpen: boolean; placeholder?: ReactNode }) {
  const wide = useIsWide();
  // The list keeps the same place in the tree in every layout, so changing the window size never remounts it.
  // 列表在每种布局中都处于树中的同一位置，所以改变窗口大小不会让它重新挂载。
  return (
    <div className={wide ? 'grid min-h-[100dvh] grid-cols-[minmax(320px,380px)_minmax(0,1fr)]' : undefined}>
      <AdminPaneContext.Provider value={wide ? 'list' : 'main'}>
        <div
          hidden={!wide && detailOpen}
          className={wide ? 'sticky top-0 h-[100dvh] overflow-y-auto overscroll-contain border-r-[0.5px] border-wx-line bg-wx-canvas' : undefined}
        >
          {list}
        </div>
      </AdminPaneContext.Provider>
      {wide || detailOpen ? (
        <AdminPaneContext.Provider value={wide ? 'detail' : 'main'}>
          <div className="min-w-0">{detailOpen ? detail : (placeholder ?? <DetailPlaceholder />)}</div>
        </AdminPaneContext.Provider>
      ) : null}
    </div>
  );
}
