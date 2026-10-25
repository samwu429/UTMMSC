import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemberSelf, Role } from '@utmmsc/shared';
import { useSummarySync } from './AdminLayout';

/**
 * Unit tests run in Node with no DOM, so React's useEffect is replaced by a small runner that, like React, runs an
 * effect when its dependencies differ from the last render and cleans up before running it again or on unmount.
 * 单元测试在没有 DOM 的 Node 中运行，因此把 React 的 useEffect 换成一个小的执行器：与 React 一样，依赖与上一次渲染不同时执行副作用，
 * 再次执行之前或卸载时先清理。
 */
const effects = vi.hoisted(() => {
  const slots: { deps?: readonly unknown[]; cleanup?: (() => void) | void }[] = [];
  let index = 0;
  const same = (a: readonly unknown[] | undefined, b: readonly unknown[] | undefined) =>
    a !== undefined && b !== undefined && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  return {
    begin() {
      index = 0;
    },
    use(effect: () => (() => void) | void, deps?: readonly unknown[]) {
      const slot = slots[index] ?? (slots[index] = {});
      index += 1;
      if (same(slot.deps, deps)) return;
      slot.cleanup?.();
      slot.deps = deps;
      slot.cleanup = effect();
    },
    unmount() {
      for (const slot of slots) slot.cleanup?.();
      slots.length = 0;
    },
  };
});

vi.mock('react', async (importOriginal) => ({ ...(await importOriginal<typeof import('react')>()), useEffect: effects.use }));

/** The session as a plain holder, since the hook runs outside a React render. */
/** 会话换成普通容器，因为这个 hook 在 React 渲染之外运行。 */
const held = vi.hoisted(() => ({ session: { token: 'tok' as string | null, member: null as unknown, mediaToken: null as string | null } }));

vi.mock('../../../shared/session/store', () => {
  const hook = (selector: (state: typeof held.session) => unknown) => selector(held.session);
  return {
    useSessionStore: Object.assign(hook, {
      getState: () => held.session,
      setState: (patch: Partial<typeof held.session>) => Object.assign(held.session, patch),
      subscribe: () => () => undefined,
    }),
  };
});

const summary = vi.hoisted(() => ({ refresh: vi.fn(async () => undefined) }));

vi.mock('../state/summaryStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../state/summaryStore')>();
  return { ...actual, useAdminSummary: Object.assign(() => undefined, { getState: () => ({ refresh: summary.refresh }) }) };
});

function member(role: Role, id = 'mem_a'): MemberSelf {
  return {
    id,
    displayName: 'A',
    role,
    enrollmentStatus: 'student',
    graduationYear: 2024,
    major: null,
    headline: null,
    about: null,
    location: null,
    skills: [],
    openTo: [],
    avatarKey: null,
    coverKey: null,
    email: 'a@mail.utoronto.ca',
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    realRole: 'superadmin',
    actingRole: role === 'superadmin' ? null : role,
  };
}

/** Just enough of document for visibilitychange. */
/** 仅够处理 visibilitychange 的 document。 */
function fakeDocument() {
  const listeners = new Set<() => void>();
  return {
    visibilityState: 'visible' as 'visible' | 'hidden',
    addEventListener: (type: string, listener: () => void) => {
      if (type === 'visibilitychange') listeners.add(listener);
    },
    removeEventListener: (type: string, listener: () => void) => {
      if (type === 'visibilitychange') listeners.delete(listener);
    },
    show(state: 'visible' | 'hidden') {
      this.visibilityState = state;
      for (const listener of [...listeners]) listener();
    },
    listening: () => listeners.size,
  };
}

/** One render of a component that holds the hook, as AdminLayout does. */
/** 持有该 hook 的组件渲染一次，与 AdminLayout 相同。 */
function SummarySync(): null {
  effects.begin();
  useSummarySync();
  return null;
}

describe('useSummarySync', () => {
  let doc: ReturnType<typeof fakeDocument>;

  beforeEach(() => {
    summary.refresh.mockClear();
    held.session = { token: 'tok', member: member('president'), mediaToken: null };
    doc = fakeDocument();
    vi.stubGlobal('document', doc);
  });

  afterEach(() => {
    effects.unmount();
    vi.unstubAllGlobals();
  });

  it('asks on entering admin, and not again on a render with the same role', () => {
    SummarySync();
    expect(summary.refresh).toHaveBeenCalledTimes(1);
    SummarySync();
    expect(summary.refresh).toHaveBeenCalledTimes(1);
  });

  it('asks again when the viewed role changes while admin stays open, as after 回到系统管理员', () => {
    SummarySync();
    held.session = { ...held.session, member: member('superadmin') };
    SummarySync();
    expect(summary.refresh).toHaveBeenCalledTimes(2);
    held.session = { ...held.session, member: member('head_events') };
    SummarySync();
    expect(summary.refresh).toHaveBeenCalledTimes(3);
    // The foreground listener is not added a second time.
    // 回到前台的监听不会重复添加。
    expect(doc.listening()).toBe(1);
  });

  it('asks again when another member is signed in with the same role', () => {
    SummarySync();
    held.session = { ...held.session, member: member('president', 'mem_b') };
    SummarySync();
    expect(summary.refresh).toHaveBeenCalledTimes(2);
  });

  it('asks again when the app comes back to the foreground, until admin is left', () => {
    SummarySync();
    doc.show('hidden');
    expect(summary.refresh).toHaveBeenCalledTimes(1);
    doc.show('visible');
    expect(summary.refresh).toHaveBeenCalledTimes(2);
    effects.unmount();
    doc.show('visible');
    expect(summary.refresh).toHaveBeenCalledTimes(2);
    expect(doc.listening()).toBe(0);
  });
});
