import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TIMETABLE_SETTINGS, instantAt, type TimetableSettings } from '@utmmsc/shared';

// Server rendering reads plain objects the test sets instead of the real stores.
// 服务端渲染读取测试自己设置的普通对象，而不是真正的 store。
const state = vi.hoisted(() => ({
  view: null as unknown,
  dismissedEmpty: false,
  now: 0,
  notifications: { capability: 'native', device: 'on', serverReady: null, busy: false, error: null } as Record<string, unknown>,
}));

vi.mock('../state/timetableStore', () => {
  const store = { setDismissedEmpty: vi.fn() };
  return {
    useTimetableView: () => state.view,
    useTimetable: Object.assign((select: (s: unknown) => unknown) => select({ dismissedEmpty: state.dismissedEmpty, ...store }), {
      getState: () => ({ dismissedEmpty: state.dismissedEmpty, ...store }),
    }),
    refresh: vi.fn(() => Promise.resolve()),
    setAssignmentDone: vi.fn(),
    updateSettings: vi.fn(),
  };
});

vi.mock('../../notifications/notifications', () => ({
  useNotificationStore: Object.assign((select: (s: unknown) => unknown) => select(state.notifications), { getState: () => state.notifications }),
  enableNotifications: vi.fn(() => Promise.resolve('on')),
}));

vi.mock('../model/useTorontoNow', () => ({
  useTorontoNow: () => state.now,
  useTorontoToday: () => '',
}));

// The undo pill is drawn through a portal, which needs a document; this stand-in shows the lift the card asks for.
// 撤销胶囊通过 portal 绘制，需要 document；这个替身显示卡片要求的抬高高度。
vi.mock('../ui/UndoBar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ui/UndoBar')>();
  const { createElement: h } = await import('react');
  return { ...actual, UndoBar: ({ lift }: { lift?: string }) => h('i', { 'data-undo-lift': lift ?? '' }) };
});

// React warns that layout effects do not run on the server; that is expected here and says nothing about the card.
// React 会提示布局副作用在服务端不运行；这在这里是预期的，与卡片本身无关。
const consoleError = console.error.bind(console);
vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].includes('useLayoutEffect does nothing on the server')) return;
  consoleError(...args);
});

const { TAB_BAR_LIFT, TodayCard } = await import('./TodayCard');
const { assignments, courses, fall, skips } = await import('../ics/fixtures.testdata');

const on: TimetableSettings = { ...DEFAULT_TIMETABLE_SETTINGS, assignmentOffsets: ['1d', '1h'], classReminders: true, classLeadMin: 10 };

function view(overrides: Record<string, unknown> = {}) {
  return { loaded: true, rev: 3, remindersAllowed: true, settings: on, terms: [fall], courses, skips, assignments, pendingIds: new Set<string>(), ...overrides };
}

function render(): string {
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(TodayCard)));
}

function text(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');
}

describe('TodayCard', () => {
  beforeEach(() => {
    state.view = view();
    state.dismissedEmpty = false;
    state.now = instantAt('2026-10-26', 9 * 60 + 25);
    state.notifications = { capability: 'native', device: 'on', serverReady: null, busy: false, error: null };
  });

  it('shows the next class, the assignment due first and the reminder', () => {
    const html = render();
    const words = text(html);
    expect(words).toContain('今日课表');
    expect(words).toContain('周一 · 第9周');
    expect(words).toContain('下一节');
    expect(words).toContain('10:00–10:50 · MAT102 · DV 2074');
    expect(words).toContain('35 分钟后');
    expect(words).toContain('PS3');
    expect(words).toContain('MAT102 · 周五 23:59 · 还剩 4 天');
    expect(words).toContain('上课提醒 · 提前 10 分钟 · 下次 09:50');
    expect(html).toContain('href="/timetable/due?focus=ta_AAAAAAAAAAAAAAAAAAAAA1"');
    expect(html).toContain('aria-label="完成 PS3"');
  });

  it('lifts the undo pill clear of the tab bar and its raised 聊天 drop', () => {
    expect(render()).toContain(`data-undo-lift="${TAB_BAR_LIFT}"`);
    // The tab bar is 66px tall and the drop under the centred pill reaches 27px above it; the pill sits 1.25rem over its lift.
    // 标签栏高 66px，居中胶囊正下方的水滴又高出 27px；胶囊位于抬高高度之上 1.25rem。
    expect(TAB_BAR_LIFT).toMatch(/^\d+(\.\d+)?rem$/);
    expect(Number.parseFloat(TAB_BAR_LIFT) * 16 + 20).toBeGreaterThanOrEqual(66 + 27);
  });

  it('marks an assignment still waiting to sync', () => {
    state.view = view({ pendingIds: new Set([assignments[0]!.id]) });
    expect(render()).toContain('aria-label="待同步"');
  });

  it('offers to turn class reminders on', () => {
    state.view = view({ settings: { ...on, classReminders: false } });
    expect(text(render())).toContain('开启上课提醒');
  });

  it('keeps its height with skeleton lines before the first data', () => {
    state.view = view({ loaded: false, courses: [], assignments: [] });
    const html = render();
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('min-h-[9.5rem]');
  });

  it('invites an empty timetable, and shrinks to one line once dismissed', () => {
    state.view = view({ courses: [], terms: [], skips: [], assignments: [] });
    const words = text(render());
    expect(words).toContain('添加课表，上课前提醒你');
    expect(words).toContain('手动添加');
    expect(words).toContain('导入日历文件');
    expect(words).toContain('以后再说');
    state.dismissedEmpty = true;
    const compact = render();
    expect(text(compact)).toContain('课表 · 添加课程');
    expect(compact).not.toContain('今日课表');
    expect(compact).toContain('href="/timetable?add=course"');
  });
});
