import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Just enough of the DOM for snackbar.ts: elements that hold children, attributes and click listeners.
 * 刚好够 snackbar.ts 使用的 DOM：可以包含子元素、属性和点击监听器的元素。
 */
class FakeElement {
  children: FakeElement[] = [];
  id = '';
  className = '';
  textContent = '';
  type = '';
  isConnected = false;
  style: Record<string, string> = {};
  private listeners = new Map<string, (() => void)[]>();
  setAttribute(): void {}
  appendChild(child: FakeElement): FakeElement {
    child.isConnected = this.isConnected;
    this.children.push(child);
    return child;
  }
  replaceChildren(...children: FakeElement[]): void {
    this.children = children;
  }
  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  matches(): boolean {
    return false;
  }
  contains(): boolean {
    return false;
  }
  click(): void {
    for (const listener of this.listeners.get('click') ?? []) listener();
  }
}

const body = new FakeElement();
body.isConnected = true;

type Snackbar = typeof import('./snackbar');
let api: Snackbar;

beforeAll(async () => {
  vi.stubGlobal('document', { createElement: () => new FakeElement(), body, activeElement: null });
  api = await import('./snackbar');
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.useFakeTimers();
  api.dismissSnackbar();
  vi.runAllTimers();
});

function root(): FakeElement {
  const element = body.children[0];
  if (!element) throw new Error('no snackbar root');
  return element;
}

/** The action button of the snackbar on screen. */
/** 屏幕上提示条的操作按钮。 */
function actionButton(): FakeElement {
  const button = root().children[0]?.children[1];
  if (!button) throw new Error('no action button');
  return button;
}

describe('snackbar onClose', () => {
  it('is called once when the time runs out', () => {
    const onClose = vi.fn();
    api.snackbar({ text: '已删除 1 个表情', ms: 5000, onClose });
    vi.advanceTimersByTime(4000);
    expect(onClose).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    expect(onClose).toHaveBeenCalledTimes(1);
    vi.runAllTimers();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('is not called when the action closes it', () => {
    const onClose = vi.fn();
    const onAction = vi.fn();
    api.snackbar({ text: '已删除 1 个表情', action: { label: '撤销', onAction }, onClose });
    vi.advanceTimersByTime(100);
    actionButton().click();
    expect(onAction).toHaveBeenCalledTimes(1);
    vi.runAllTimers();
    api.dismissSnackbar();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('is called when another snackbar replaces it, and only for that one', () => {
    const first = vi.fn();
    const second = vi.fn();
    api.snackbar({ text: 'one', onClose: first });
    vi.advanceTimersByTime(100);
    api.snackbar({ text: 'two', onClose: second });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it('is called by dismissSnackbar, also before the first show', () => {
    const onClose = vi.fn();
    api.snackbar({ text: 'one', onClose });
    api.dismissSnackbar();
    expect(onClose).toHaveBeenCalledTimes(1);
    api.dismissSnackbar();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('is called once by the returned close function', () => {
    const onClose = vi.fn();
    const close = api.snackbar({ text: 'one', onClose });
    vi.advanceTimersByTime(100);
    close();
    close();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('is called at once when there is nothing to show', () => {
    const onClose = vi.fn();
    api.snackbar({ text: '', onClose });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('leaves snackbars without onClose working as before', () => {
    const onAction = vi.fn();
    api.snackbar({ text: '已移除', action: { label: '撤销', onAction } });
    vi.advanceTimersByTime(100);
    actionButton().click();
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(root().children).toHaveLength(0);
  });
});
