import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { course, meeting, term } from '../model/fixtures.testdata';
import { WeekView, type WeekViewProps } from './WeekView';

// React warns that layout effects do not run on the server; that is expected here and says nothing about the grid.
// React 会提示布局副作用在服务端不运行；这在这里是预期的，与课表本身无关。
const consoleError = console.error.bind(console);
vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].includes('useLayoutEffect does nothing on the server')) return;
  consoleError(...args);
});

const FALL = term();
const props: WeekViewProps = {
  monday: '2026-10-19',
  data: { terms: [FALL], courses: [course({ termId: FALL.id, meetings: [meeting({ weekday: 1, startMin: 600, endMin: 650 })] })], skips: [] },
  weekdays: [1, 2, 3, 4, 5, 6, 7],
  today: '2026-10-21',
  dueDates: new Set<string>(),
  locale: 'zh',
  pendingIds: new Set<string>(),
  flashKey: null,
  hint: null,
  onStep: () => undefined,
  onSlot: () => undefined,
  onOpen: () => undefined,
  onMenu: () => undefined,
};

/** The opening tag of the first element whose class list has every one of `classes`. */
/** 类名包含 `classes` 中全部类的第一个元素的开始标签。 */
function tagWith(html: string, ...classes: string[]): { at: number; tag: string } | null {
  for (const match of html.matchAll(/<div [^>]*class="([^"]*)"[^>]*>/g)) {
    const list = match[1]!.split(/\s+/);
    if (classes.every((name) => list.includes(name))) return { at: match.index ?? 0, tag: match[0] };
  }
  return null;
}

/** Whether the element opening at `inner` sits inside the element opening at `outer`, by counting the divs between them. */
/** 通过数两者之间的 div，判断从 `inner` 开始的元素是否位于从 `outer` 开始的元素之内。 */
function within(html: string, outer: number, inner: number): boolean {
  let depth = 0;
  for (const match of html.slice(outer, inner).matchAll(/<div[\s>]|<\/div>/g)) {
    depth += match[0] === '</div>' ? -1 : 1;
    if (depth === 0) return false;
  }
  return inner > outer && depth > 0;
}

describe('WeekView', () => {
  it('keeps the day heads inside the scroller, stuck to its top, so a scrollbar narrows them and the columns alike', () => {
    const html = renderToStaticMarkup(createElement(WeekView, props));
    const scroller = tagWith(html, 'overflow-y-auto');
    const heads = tagWith(html, 'tt-pane', 'h-9');
    const headRow = tagWith(html, 'sticky', 'top-0');
    expect(scroller).not.toBeNull();
    expect(heads).not.toBeNull();
    expect(headRow).not.toBeNull();
    // Nothing but the scroller and what it holds sits in the view, and the heads come after the scroller opens.
    // 视图中只有滚动区域及其内容，日期行在滚动区域开始之后。
    expect(html.indexOf('<div', 1)).toBe(scroller!.at);
    expect(within(html, scroller!.at, headRow!.at)).toBe(true);
    expect(within(html, headRow!.at, heads!.at)).toBe(true);
    expect(html.match(/tt-viewport/g)).toHaveLength(2);
  });
});
