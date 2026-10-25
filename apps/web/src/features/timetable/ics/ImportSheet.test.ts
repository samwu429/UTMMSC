import { createElement, Suspense } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, it, vi } from 'vitest';

// Server rendering has no portals and no document, so the portal hands its children back and records its container.
// 服务端渲染没有 portal 也没有 document，因此 portal 直接返回子元素，并记下它的容器。
const state = vi.hoisted(() => ({
  body: { nodeName: 'BODY' },
  containers: [] as unknown[],
}));

vi.mock('react-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-dom')>();
  return {
    ...actual,
    createPortal: (children: unknown, container: unknown) => {
      state.containers.push(container);
      return children;
    },
  };
});

vi.mock('../state/timetableStore', () => ({
  useTimetableView: () => ({ loaded: true, rev: 1, remindersAllowed: true, settings: {}, terms: [], courses: [], skips: [], assignments: [], pendingIds: new Set<string>() }),
  importAll: vi.fn(() => Promise.resolve({})),
}));

vi.mock('../../../shared/ui/overlayHistory', () => ({ useBackToClose: vi.fn() }));

vi.stubGlobal('document', { body: state.body });
afterAll(() => {
  vi.unstubAllGlobals();
});

// React warns that layout effects do not run on the server; that is expected here and says nothing about the sheet.
// React 会提示布局副作用在服务端不运行；这在这里是预期的，与面板本身无关。
const consoleError = console.error.bind(console);
vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].includes('useLayoutEffect does nothing on the server')) return;
  consoleError(...args);
});

const { default: ImportSheet } = await import('./ImportSheet');
const { FullSheet } = await import('../ui/Sheet');

/** The z-index of the full-screen layer a sheet renders, from its Tailwind class. */
/** 面板所渲染的全屏层的 z-index，取自它的 Tailwind 类名。 */
function layer(markup: string): number {
  const match = /fixed inset-0 z-\[(\d+)\]/.exec(markup);
  return match ? Number(match[1]) : Number.NaN;
}

describe('ImportSheet', () => {
  it('is portaled to body above every FullSheet, so 课表设置 cannot cover it', () => {
    state.containers = [];
    const html = renderToStaticMarkup(createElement(Suspense, { fallback: null }, createElement(ImportSheet, { onClose: () => undefined })));
    expect(state.containers).toEqual([state.body]);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('导入日历文件');

    const settings = renderToStaticMarkup(createElement(FullSheet, { title: '课表设置', onClose: () => undefined, children: null }));
    const raised = renderToStaticMarkup(createElement(FullSheet, { title: '学期', onClose: () => undefined, children: null, raised: true }));
    expect(layer(html)).toBeGreaterThan(layer(settings));
    expect(layer(html)).toBeGreaterThan(layer(raised));
    // Below menus (60), so an ActionSheet, a confirm or a toast still shows over it.
    // 低于菜单（60），因此操作菜单、确认框和提示仍显示在它之上。
    expect(layer(html)).toBeLessThan(60);
  });
});
