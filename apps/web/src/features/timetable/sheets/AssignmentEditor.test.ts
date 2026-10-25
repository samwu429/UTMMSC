import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { snapshot, tid, toronto } from '../model/fixtures.testdata';
import type { TimetableView } from '../state/timetableStore';
import type { AssignmentDraft } from './assignmentDraft';

const NOW = toronto('2026-10-21', '18:00'); // Wednesday

// Server rendering has no portals, so the sheet's portal hands its children back.
// 服务端渲染没有 portal，因此面板的 portal 直接返回子元素。
vi.mock('react-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-dom')>();
  return { ...actual, createPortal: (children: unknown) => children };
});

vi.mock('../state/timetableStore', () => ({
  saveAssignment: vi.fn(),
  deleteAssignment: vi.fn(),
  setAssignmentDone: vi.fn(),
}));

vi.mock('../model/useTorontoNow', () => ({ useTorontoNow: () => NOW }));
vi.mock('../../../shared/ui/overlayHistory', () => ({ useBackToClose: vi.fn() }));

// The sheet names document.body as its portal's container, and Node has no document.
// 面板把 document.body 作为 portal 的容器，而 Node 中没有 document。
vi.stubGlobal('document', { body: { nodeName: 'BODY' } });
afterAll(() => {
  vi.unstubAllGlobals();
});

// React warns that layout effects do not run on the server; that is expected here and says nothing about the form.
// React 会提示布局副作用在服务端不运行；这在这里是预期的，与表单本身无关。
const consoleError = console.error.bind(console);
vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].includes('useLayoutEffect does nothing on the server')) return;
  consoleError(...args);
});

const { AssignmentEditor } = await import('./AssignmentEditor');

const VIEW: TimetableView = { ...snapshot(), loaded: true, pendingIds: new Set<string>() };

function draft(dueDate: string): AssignmentDraft {
  return { id: tid('ta', 'x'), isNew: true, title: 'PS3', courseId: null, dueDate, dueMin: 23 * 60 + 59, offsets: [], notes: '' };
}

function render(dueDate: string): string {
  return renderToStaticMarkup(createElement(AssignmentEditor, { initial: draft(dueDate), view: VIEW, locale: 'zh', onClose: () => undefined }));
}

/** The opening tag of the 选日期 field. */
/** 「选日期」输入框的开始标签。 */
function dateField(html: string): string {
  return /<input[^>]*type="date"[^>]*>/.exec(html)?.[0] ?? '';
}

describe('AssignmentEditor', () => {
  it('draws a due date the calendar cannot read instead of replacing the page with the error screen', () => {
    // A half-typed year from the date field, a year before 1970, and the empty date of a stored item that cannot be read.
    // 日期栏中只输入了一半的年份、1970 年之前的年份，以及无法读取的已存条目留下的空日期。
    for (const dueDate of ['0002-10-25', '1969-12-31', '']) {
      const html = render(dueDate);
      expect(html).toContain('添加作业');
      expect(html).toContain('选日期');
    }
  });

  it('names a picked date, and bounds the picker by the window the server accepts', () => {
    const html = render('2026-11-10');
    expect(html).toContain('周二 11月10日');
    const field = dateField(html);
    expect(field).toContain('min="2025-10-21"');
    expect(field).toContain('max="2027-11-25"');
    expect(field).toContain('value="2026-11-10"');
  });
});
