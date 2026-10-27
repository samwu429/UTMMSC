import { describe, expect, it } from 'vitest';
import { buildGridTiles } from '../composer/stickerGrid';
import {
  NO_STICKER_SELECTION,
  allStickersSelected,
  selectedInOrder,
  stickerSelectionReducer as reduce,
  type StickerSelection,
} from './stickerSelection';

function ids(state: StickerSelection): string[] {
  return [...state.selected].sort();
}

describe('stickerSelectionReducer', () => {
  it('enters selection mode with the tapped sticker selected', () => {
    const state = reduce(NO_STICKER_SELECTION, { type: 'enterWith', id: 'a' });
    expect(state.selecting).toBe(true);
    expect(ids(state)).toEqual(['a']);
  });

  it('enters with nothing selected from 整理', () => {
    const state = reduce(NO_STICKER_SELECTION, { type: 'enter' });
    expect(state).toEqual({ selecting: true, selected: new Set() });
    expect(reduce(state, { type: 'enter' })).toBe(state);
  });

  it('toggles inside selection mode only', () => {
    expect(reduce(NO_STICKER_SELECTION, { type: 'toggle', id: 'a' })).toBe(NO_STICKER_SELECTION);
    let state = reduce(NO_STICKER_SELECTION, { type: 'enterWith', id: 'a' });
    state = reduce(state, { type: 'toggle', id: 'b' });
    expect(ids(state)).toEqual(['a', 'b']);
    state = reduce(state, { type: 'toggle', id: 'a' });
    expect(ids(state)).toEqual(['b']);
    expect(state.selecting).toBe(true);
  });

  it('selects all and clears, staying in selection mode', () => {
    let state = reduce(NO_STICKER_SELECTION, { type: 'enter' });
    state = reduce(state, { type: 'selectAll', ids: ['a', 'b', 'c'] });
    expect(ids(state)).toEqual(['a', 'b', 'c']);
    expect(reduce(state, { type: 'selectAll', ids: ['c', 'b', 'a'] })).toBe(state);
    state = reduce(state, { type: 'clear' });
    expect(state).toEqual({ selecting: true, selected: new Set() });
    expect(reduce(state, { type: 'clear' })).toBe(state);
  });

  it('prunes ids that left the collection and keeps the state when none did', () => {
    let state = reduce(NO_STICKER_SELECTION, { type: 'enter' });
    state = reduce(state, { type: 'selectAll', ids: ['a', 'b', 'c'] });
    expect(reduce(state, { type: 'prune', ids: ['a', 'b', 'c', 'd'] })).toBe(state);
    state = reduce(state, { type: 'prune', ids: ['a', 'c'] });
    expect(ids(state)).toEqual(['a', 'c']);
    expect(state.selecting).toBe(true);
  });

  it('leaves selection mode and forgets the selection on 完成', () => {
    let state = reduce(NO_STICKER_SELECTION, { type: 'enterWith', id: 'a' });
    state = reduce(state, { type: 'exit' });
    expect(state).toBe(NO_STICKER_SELECTION);
    expect(reduce(state, { type: 'exit' })).toBe(state);
  });

  it('does not reselect what is already selected', () => {
    const state = reduce(NO_STICKER_SELECTION, { type: 'enterWith', id: 'a' });
    expect(reduce(state, { type: 'enterWith', id: 'a' })).toBe(state);
  });
});

describe('selection helpers', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('lists the selection in grid order', () => {
    expect(selectedInOrder(items, new Set(['c', 'a']))).toEqual(['a', 'c']);
    expect(selectedInOrder(items, new Set(['gone']))).toEqual([]);
  });

  it('knows when everything is selected', () => {
    expect(allStickersSelected(items, new Set(['a', 'b', 'c']))).toBe(true);
    expect(allStickersSelected(items, new Set(['a', 'b']))).toBe(false);
    expect(allStickersSelected([], new Set())).toBe(false);
  });
});

describe('the + tile while selecting', () => {
  it('keeps every tile in its cell when selection starts', () => {
    const items = [{ id: 'a' }, { id: 'b' }];
    const uploads = [{ localId: 'upload-1' }];
    const normal = buildGridTiles(items, uploads, { addInactive: false });
    const selecting = buildGridTiles(items, uploads, { addInactive: true });
    expect(normal.map((tile) => tile.key)).toEqual(['add', 'upload:upload-1', 'item:a', 'item:b']);
    expect(selecting.map((tile) => tile.key)).toEqual(normal.map((tile) => tile.key));
    expect(selecting[0]).toEqual({ kind: 'add', key: 'add', inactive: true });
    expect(normal[0]).toEqual({ kind: 'add', key: 'add', inactive: false });
  });

  it('keeps the + tile first in an empty collection', () => {
    expect(buildGridTiles([], [], { addInactive: true }).map((tile) => tile.key)).toEqual(['add']);
  });
});
