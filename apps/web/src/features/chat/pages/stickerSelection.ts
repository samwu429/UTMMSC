/**
 * Selection on the 我的表情 manage screen, as a pure reducer. The tap that enters selection mode also selects that
 * sticker; afterwards a tap toggles. Ids that left the collection (removed here or on another device) are pruned.
 * 「我的表情」管理界面的选择状态，以纯 reducer 实现。进入选择模式的那次点按同时选中该表情；之后每次点按切换选中状态。
 * 已离开表情列表的 id（在这里或其他设备上删除）会被清理掉。
 */

export interface StickerSelection {
  selecting: boolean;
  selected: ReadonlySet<string>;
}

export type StickerSelectionAction =
  // 整理: selection mode with nothing selected.
  // 「整理」：进入选择模式，不选中任何表情。
  | { type: 'enter' }
  // A tap on a sticker outside selection mode: enters it with that sticker selected.
  // 不在选择模式时点按表情：进入选择模式并选中该表情。
  | { type: 'enterWith'; id: string }
  | { type: 'toggle'; id: string }
  | { type: 'selectAll'; ids: readonly string[] }
  | { type: 'clear' }
  // The ids still in the collection; every other selected id is dropped.
  // 仍在表情列表中的 id；其余已选中的 id 都会被去掉。
  | { type: 'prune'; ids: readonly string[] }
  // 完成: leaves selection mode.
  // 「完成」：退出选择模式。
  | { type: 'exit' };

const NONE: ReadonlySet<string> = new Set();

export const NO_STICKER_SELECTION: StickerSelection = { selecting: false, selected: NONE };

function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

/** Returns the same state object when nothing changes, so React skips the render. */
/** 没有变化时返回同一个状态对象，React 因此跳过渲染。 */
export function stickerSelectionReducer(state: StickerSelection, action: StickerSelectionAction): StickerSelection {
  switch (action.type) {
    case 'enter':
      return state.selecting ? state : { selecting: true, selected: NONE };
    case 'enterWith': {
      if (state.selecting && state.selected.has(action.id)) return state;
      const selected = new Set(state.selecting ? state.selected : NONE);
      selected.add(action.id);
      return { selecting: true, selected };
    }
    case 'toggle': {
      if (!state.selecting) return state;
      const selected = new Set(state.selected);
      if (selected.has(action.id)) selected.delete(action.id);
      else selected.add(action.id);
      return { selecting: true, selected };
    }
    case 'selectAll': {
      if (!state.selecting) return state;
      const selected = new Set(action.ids);
      return sameIds(selected, state.selected) ? state : { selecting: true, selected };
    }
    case 'clear':
      return state.selected.size === 0 ? state : { selecting: state.selecting, selected: NONE };
    case 'prune': {
      if (state.selected.size === 0) return state;
      const present = new Set(action.ids);
      const selected = new Set([...state.selected].filter((id) => present.has(id)));
      return selected.size === state.selected.size ? state : { selecting: state.selecting, selected };
    }
    case 'exit':
      return state.selecting || state.selected.size > 0 ? NO_STICKER_SELECTION : state;
  }
}

/** The selected ids in the order the grid shows them, for 移到最前 and 删除. */
/** 按格子中的显示顺序排列的已选 id，用于「移到最前」和「删除」。 */
export function selectedInOrder(items: readonly { id: string }[], selected: ReadonlySet<string>): string[] {
  if (selected.size === 0) return [];
  return items.filter((item) => selected.has(item.id)).map((item) => item.id);
}

/** Whether every sticker is selected, which turns 全选 into 取消全选. */
/** 是否所有表情都已选中，此时「全选」变为「取消全选」。 */
export function allStickersSelected(items: readonly { id: string }[], selected: ReadonlySet<string>): boolean {
  return items.length > 0 && items.every((item) => selected.has(item.id));
}
