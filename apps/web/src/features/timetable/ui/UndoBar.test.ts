import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TICK_GUARD_MS, UndoLayer, createTickGuard } from './UndoBar';

const OFFER = { id: 1, text: '已完成', undo: () => undefined };

function layer(lift?: string): string {
  return renderToStaticMarkup(createElement(UndoLayer, { offer: OFFER, lift, onUndo: () => undefined }));
}

/** The z-index of the outermost element, from its Tailwind class. */
/** 最外层元素的 z-index，取自其 Tailwind 类名。 */
function outerZ(html: string): number {
  const outer = /^<div [^>]*class="([^"]*)"/.exec(html)?.[1] ?? '';
  const z = /(?:^|\s)z-\[?(\d+)\]?(?:\s|$)/.exec(outer)?.[1];
  return z === undefined ? Number.NaN : Number(z);
}

describe('UndoLayer', () => {
  it('stays over the tab bar and under every sheet, menu and dialog', () => {
    // The tab bar and the sync banner are z-30; HalfSheet and ImportSheet z-50, FullSheet z-55, ActionSheet z-60, confirm z-70.
    // 标签栏和同步提示为 z-30；HalfSheet 和 ImportSheet 为 z-50，FullSheet 为 z-55，ActionSheet 为 z-60，确认框为 z-70。
    const z = outerZ(layer());
    expect(z).toBeGreaterThan(30);
    expect(z).toBeLessThan(50);
  });

  it('rises by the lift it is given, above the safe area', () => {
    expect(layer()).toContain('bottom:calc(var(--safe-bottom) + 0px + 1.25rem)');
    expect(layer('5rem')).toContain('bottom:calc(var(--safe-bottom) + 5rem + 1.25rem)');
  });

  it('lets taps through everywhere but the pill', () => {
    const html = layer();
    expect(/^<div [^>]*class="[^"]*pointer-events-none/.test(html)).toBe(true);
    expect(html).toContain('pointer-events-auto');
    expect(html).toContain('撤销');
  });

  it('draws nothing without an offer', () => {
    const html = renderToStaticMarkup(createElement(UndoLayer, { offer: null, onUndo: () => undefined }));
    expect(html).not.toContain('撤销');
  });
});

describe('createTickGuard', () => {
  it('ignores a second tap right after a tick, then lets the next one through', () => {
    let now = 1000;
    const allowed = createTickGuard(() => now);
    expect(allowed()).toBe(true);
    now += 120;
    expect(allowed()).toBe(false);
    now += TICK_GUARD_MS - 120 - 1;
    expect(allowed()).toBe(false);
    now += 1;
    expect(allowed()).toBe(true);
  });

  it('times the window from the last tap it let through, not from the ignored ones', () => {
    let now = 0;
    const allowed = createTickGuard(() => now);
    expect(allowed()).toBe(true);
    now = 300;
    expect(allowed()).toBe(false);
    now = TICK_GUARD_MS;
    expect(allowed()).toBe(true);
  });
});
