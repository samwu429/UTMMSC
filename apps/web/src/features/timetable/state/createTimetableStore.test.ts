import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SaveCourseBody, TimetableLocale, TimetableResponse, TimetableUnchanged, TimetableWriteResponse } from '@utmmsc/shared';
import { ApiClientError } from '../../../shared/api/errors';
import type { SyncStateStorage } from '../../chat/state/safeStorage';
import { assignment, course, snapshot, term, tid } from '../model/fixtures.testdata';
import { REFRESH_THROTTLE_MS, TIMETABLE_STORAGE_KEY, createTimetableStore, type TimetableApiPort } from './createTimetableStore';
import type { PersistedTimetable } from './types';

function memoryStorage(initial?: PersistedTimetable): SyncStateStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  if (initial) data.set(TIMETABLE_STORAGE_KEY, JSON.stringify({ state: initial, version: 1 }));
  return {
    data,
    getItem: (name) => data.get(name) ?? null,
    setItem: (name, value) => void data.set(name, value),
    removeItem: (name) => void data.delete(name),
  };
}

type Call = { name: keyof TimetableApiPort; args: unknown[] };

/** A small stand-in for the API: it keeps a rev and a snapshot, and can fail or hold the next answers. */
/** 接口的简易替身：保存 rev 和快照，可以让接下来的应答失败或暂缓。 */
class FakeServer {
  rev = 0;
  remindersAllowed = true;
  data: TimetableResponse = snapshot({ rev: 0 });
  calls: Call[] = [];
  failures: unknown[] = [];
  gate: Promise<void> | null = null;
  private open: (() => void) | null = null;

  hold() {
    this.gate = new Promise((resolve) => {
      this.open = resolve;
    });
  }

  release() {
    this.open?.();
    this.gate = null;
  }

  names() {
    return this.calls.map((call) => call.name);
  }

  private async answer<T>(name: keyof TimetableApiPort, args: unknown[], make: () => T): Promise<T> {
    this.calls.push({ name, args });
    if (this.gate) await this.gate;
    const failure = this.failures.shift();
    if (failure !== undefined) throw failure;
    return make();
  }

  private write<T>(item: T): TimetableWriteResponse<T> {
    this.rev += 1;
    this.data = { ...this.data, rev: this.rev };
    return { rev: this.rev, item };
  }

  api: TimetableApiPort = {
    get: (rev) =>
      this.answer<TimetableResponse | TimetableUnchanged>('get', [rev], () =>
        rev === this.rev ? { rev: this.rev, unchanged: true, remindersAllowed: this.remindersAllowed } : { ...this.data, rev: this.rev, remindersAllowed: this.remindersAllowed },
      ),
    saveCourse: (body: SaveCourseBody) =>
      this.answer('saveCourse', [body], () => {
        const stored = { ...body, code: body.code.toUpperCase(), updatedAt: '2026-10-20T15:00:09.000Z' };
        this.data = { ...this.data, courses: [...this.data.courses.filter((c) => c.id !== body.id), stored] };
        return this.write(stored);
      }),
    deleteCourse: (id) => this.answer('deleteCourse', [id], () => this.write(null)),
    saveTerm: (body) => this.answer('saveTerm', [body], () => this.write({ ...body, updatedAt: '2026-10-20T15:00:09.000Z' })),
    deleteTerm: (id) => this.answer('deleteTerm', [id], () => this.write(null)),
    saveAssignment: (body) => this.answer('saveAssignment', [body], () => this.write({ ...assignment(), ...body, doneAt: body.done ? '2026-10-20T15:00:09.000Z' : null, updatedAt: '2026-10-20T15:00:09.000Z' })),
    setAssignmentDone: (id, done) => this.answer('setAssignmentDone', [id, done], () => this.write({ ...assignment({ id }), doneAt: done ? '2026-10-20T15:00:09.000Z' : null })),
    deleteAssignment: (id) => this.answer('deleteAssignment', [id], () => this.write(null)),
    setSkip: (body) => this.answer('setSkip', [body], () => this.write(body.skipped ? { onDate: body.onDate, meetingId: body.meetingId, label: body.label ?? null } : null)),
    updateSettings: (body) =>
      this.answer('updateSettings', [body], () => {
        this.data = { ...this.data, settings: { ...this.data.settings, ...body } };
        return this.write(this.data.settings);
      }),
    importAll: (body) => this.answer('importAll', [body], () => this.write({ terms: body.terms.length, courses: body.courses.length, assignments: body.assignments.length, skips: body.skips.length })),
    clear: () => this.answer('clear', [], () => this.write(null)),
  };
}

interface Options {
  stored?: PersistedTimetable;
  member?: string | null;
  locale?: TimetableLocale;
}

function setup(options: Options = {}) {
  const server = new FakeServer();
  const storage = memoryStorage(options.stored);
  let member: string | null = options.member === undefined ? 'm1' : options.member;
  let locale: TimetableLocale = options.locale ?? 'zh';
  let online = true;
  let now = Date.parse('2026-10-20T15:00:00.000Z');
  const memberListeners = new Set<(id: string | null) => void>();
  const localeListeners = new Set<() => void>();
  const wakeListeners = new Set<() => void>();
  const reports: unknown[] = [];
  let ids = 0;
  const store = createTimetableStore({
    api: server.api,
    storage,
    now: () => now,
    currentMember: () => member,
    onMemberChange: (listener) => {
      memberListeners.add(listener);
      return () => memberListeners.delete(listener);
    },
    appLocale: () => locale,
    onLocaleChange: (listener) => {
      localeListeners.add(listener);
      return () => localeListeners.delete(listener);
    },
    isOnline: () => online,
    onWake: (listener) => {
      wakeListeners.add(listener);
      return () => wakeListeners.delete(listener);
    },
    report: (error) => reports.push(error),
    newId: () => `id-${(ids += 1)}`,
  });
  return {
    server,
    storage,
    store,
    reports,
    state: () => store.useStore.getState(),
    stored: () => JSON.parse(storage.data.get(TIMETABLE_STORAGE_KEY) ?? 'null') as { state: PersistedTimetable } | null,
    switchMember(id: string | null) {
      member = id;
      for (const listener of memberListeners) listener(id);
    },
    setLocale(next: TimetableLocale) {
      locale = next;
      for (const listener of localeListeners) listener();
    },
    setOnline(value: boolean) {
      online = value;
    },
    wake() {
      for (const listener of wakeListeners) listener();
    },
    advance(ms: number) {
      now += ms;
    },
  };
}

const MINE: PersistedTimetable = { memberId: 'm1', snapshot: snapshot({ rev: 3, courses: [course()] }), outbox: [], dismissedEmpty: false };

let harnesses: ReturnType<typeof setup>[] = [];

function make(options?: Options) {
  const h = setup(options);
  harnesses.push(h);
  return h;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  for (const h of harnesses) h.store.actions.dispose();
  harnesses = [];
  vi.useRealTimers();
});

describe('hydration and members', () => {
  it('has the stored timetable on the very first read', () => {
    const h = make({ stored: MINE });
    expect(h.state().snapshot?.courses).toHaveLength(1);
    expect(h.state().memberId).toBe('m1');
  });

  it('never shows another member a stored timetable, and overwrites it', () => {
    const h = make({ stored: { ...MINE, memberId: 'm2' } });
    expect(h.state().snapshot).toBeNull();
    expect(h.stored()?.state.snapshot).toBeNull();
    expect(h.stored()?.state.memberId).toBe('m1');
  });

  it('starts empty when signed out', () => {
    const h = make({ stored: MINE, member: null });
    expect(h.state()).toMatchObject({ memberId: null, snapshot: null, outbox: [] });
  });

  it('drops everything on a member switch, answers in flight included', async () => {
    const h = make({ stored: MINE });
    h.server.rev = 5;
    h.server.hold();
    const pending = h.store.actions.refresh();
    h.switchMember('m2');
    expect(h.state()).toMatchObject({ memberId: 'm2', snapshot: null, outbox: [] });
    h.server.release();
    await pending;
    expect(h.state().snapshot).toBeNull();
  });
});

describe('refresh', () => {
  it('sends ?rev and keeps the snapshot when nothing changed', async () => {
    const h = make({ stored: MINE });
    h.server.rev = 3;
    h.server.remindersAllowed = false;
    const before = h.state().snapshot;
    await h.store.actions.refresh();
    expect(h.server.calls[0]?.args).toEqual([3]);
    expect(h.state().snapshot?.courses).toBe(before?.courses);
    expect(h.state().snapshot?.remindersAllowed).toBe(false);
  });

  it('takes a newer answer and throttles to one fetch per 30 s unless forced', async () => {
    const h = make({ stored: MINE });
    h.server.rev = 7;
    h.server.data = snapshot({ rev: 7, terms: [term()] });
    await h.store.actions.refresh();
    expect(h.state().snapshot?.rev).toBe(7);
    expect(h.state().snapshot?.terms).toHaveLength(1);
    await h.store.actions.refresh();
    expect(h.server.names()).toEqual(['get']);
    h.advance(REFRESH_THROTTLE_MS);
    await h.store.actions.refresh();
    await h.store.actions.refresh({ force: true });
    expect(h.server.names()).toEqual(['get', 'get', 'get']);
  });

  it('takes an answer with a lower rev when no write landed meanwhile (restored data)', async () => {
    const h = make({ stored: MINE });
    h.server.rev = 1;
    h.server.data = snapshot({ rev: 1, terms: [term()] });
    await h.store.actions.refresh();
    expect(h.state().snapshot?.rev).toBe(1);
    expect(h.state().snapshot?.courses).toEqual([]);
  });

  it('fetches again when a write landed while an older answer was on its way', async () => {
    const h = make({ stored: MINE });
    h.server.rev = 3;
    h.server.data = snapshot({ rev: 3, courses: [course()] });
    const realGet = h.server.api.get;
    let first = true;
    h.server.api.get = async (rev) => {
      if (!first) return realGet(rev);
      first = false;
      // An answer from before the write, delivered after it.
      // 写入之前的应答，在写入之后才送达。
      const stale = { ...h.server.data, rev: 2, courses: [] };
      h.store.actions.deleteAssignment(tid('ta', 'none'));
      await h.store.actions.flush();
      return stale;
    };
    await h.store.actions.refresh({ force: true });
    expect(h.state().snapshot?.rev).toBe(4);
    expect(h.state().snapshot?.courses.map((c) => c.id)).toEqual([course().id]);
  });

  /**
   * Makes the next GET answer what the server holds now, but only once `write` has been sent and answered: an answer
   * from before a write that arrives after it. The fetch that asks for next fails (the device went offline).
   * 让下一次 GET 应答服务器此刻的内容，但要等 `write` 发出并得到应答之后才送达：早于写入、却晚于它到达的应答。
   * 随后要求的重新获取失败（设备断网）。
   */
  function answerFromBefore(h: ReturnType<typeof setup>, write: () => void) {
    const realGet = h.server.api.get;
    let first = true;
    h.server.api.get = async (rev) => {
      if (!first) return realGet(rev);
      first = false;
      const stale = { ...h.server.data, rev: h.server.rev };
      write();
      await h.store.actions.flush();
      h.server.failures.push(new TypeError('Failed to fetch'));
      return stale;
    };
  }

  /** Whether the course with `id` is on screen, at every change of the store while `run` goes. */
  /** `run` 进行期间 store 每次变化时，`id` 对应的课程是否显示在屏幕上。 */
  async function shownDuring(h: ReturnType<typeof setup>, id: string, run: () => Promise<void>): Promise<boolean[]> {
    const shown: boolean[] = [];
    const stop = h.store.useStore.subscribe((state) => shown.push(state.snapshot?.courses.some((c) => c.id === id) ?? false));
    await run();
    stop();
    return shown;
  }

  it('never lets an answer from before a write drop it, also when the write shows another device wrote', async () => {
    const h = make({ stored: MINE });
    h.server.rev = 5;
    h.server.data = snapshot({ rev: 5, courses: [course()] });
    const added = tid('tc', 'new');
    // The server answered rev 5 before the write; the write answers rev 6 and the answer arrives after it.
    // 服务器在写入之前给出 rev 5 的应答；写入应答 rev 6，而这个应答在它之后才送达。
    answerFromBefore(h, () => h.store.actions.saveCourse({ ...course({ id: added, code: 'CSC108' }) }));
    const shown = await shownDuring(h, added, () => h.store.actions.refresh({ force: true }));
    expect(h.server.names()).toEqual(['saveCourse', 'get']);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.every(Boolean)).toBe(true);
    expect(h.stored()?.state.snapshot?.courses.map((c) => c.id)).toContain(added);
  });

  it('keeps a course saved during the very first fetch, before anything was stored', async () => {
    const h = make();
    h.server.rev = 5;
    h.server.data = snapshot({ rev: 5, courses: [course()] });
    const added = tid('tc', 'new');
    expect(h.state().snapshot).toBeNull();
    answerFromBefore(h, () => h.store.actions.saveCourse({ ...course({ id: added, code: 'CSC108' }) }));
    const shown = await shownDuring(h, added, () => h.store.actions.refresh());
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.every(Boolean)).toBe(true);
    expect(h.stored()?.state.snapshot?.courses.map((c) => c.id)).toContain(added);
  });

  it('never brings back a course deleted while an older answer was on its way', async () => {
    const h = make({ stored: MINE });
    h.server.rev = 5;
    h.server.data = snapshot({ rev: 5, courses: [course()] });
    // The answer still has the course: the server gave it before the delete, which answers rev 6.
    // 应答里仍有这门课：服务器在删除之前给出它，删除应答 rev 6。
    answerFromBefore(h, () => h.store.actions.deleteCourse(course().id));
    const shown = await shownDuring(h, course().id, () => h.store.actions.refresh({ force: true }));
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.some(Boolean)).toBe(false);
    expect(h.stored()?.state.snapshot?.courses).toEqual([]);
  });

  it('replays queued writes over a fresh answer', async () => {
    const h = make({ stored: MINE });
    h.setOnline(false);
    h.store.actions.saveCourse({ ...course({ id: tid('tc', 'new'), code: 'CSC108' }) });
    h.server.rev = 9;
    h.server.data = snapshot({ rev: 9, courses: [course()] });
    await h.store.actions.refresh({ force: true });
    expect(h.state().snapshot?.rev).toBe(9);
    expect(h.state().snapshot?.courses.map((c) => c.id)).toEqual([course().id, tid('tc', 'new')]);
  });
});

describe('writes', () => {
  it('applies a write at once, sends it and merges what the server stored', async () => {
    const h = make({ stored: MINE });
    h.server.rev = 3;
    h.store.actions.saveCourse({ ...course({ id: tid('tc', 'csc'), code: 'csc108' }) });
    expect(h.state().snapshot?.courses.find((c) => c.id === tid('tc', 'csc'))?.code).toBe('csc108');
    expect(h.state().outbox).toHaveLength(1);
    await h.store.actions.flush();
    expect(h.state().outbox).toEqual([]);
    expect(h.state().snapshot?.rev).toBe(4);
    expect(h.state().snapshot?.courses.find((c) => c.id === tid('tc', 'csc'))?.code).toBe('CSC108');
    expect(h.stored()?.state.outbox).toEqual([]);
  });

  it('sends queued writes one at a time, in order', async () => {
    const h = make({ stored: MINE });
    h.server.rev = 3;
    h.server.hold();
    h.store.actions.saveTerm({ id: term().id, name: 'Fall', startsOn: term().startsOn, endsOn: term().endsOn, skipWeeks: [] });
    h.store.actions.saveCourse({ ...course({ id: tid('tc', 'csc'), termId: term().id }) });
    h.store.actions.saveAssignment({ ...assignment(), courseId: tid('tc', 'csc') });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.server.names()).toEqual(['saveTerm']);
    h.server.release();
    await h.store.actions.flush();
    expect(h.server.names()).toEqual(['saveTerm', 'saveCourse', 'saveAssignment']);
    expect(h.state().snapshot?.rev).toBe(6);
  });

  it('keeps a write through network failures and backs off', async () => {
    const h = make({ stored: MINE });
    h.server.rev = 3;
    h.server.failures.push(new TypeError('Failed to fetch'), new ApiClientError(503, 'timetable_unavailable', '课表功能正在升级，请稍后再试'));
    h.store.actions.deleteCourse(course().id);
    await h.store.actions.flush();
    expect(h.state()).toMatchObject({ stalled: true });
    expect(h.state().outbox[0]?.attempts).toBe(1);
    expect(h.state().snapshot?.courses).toEqual([]);
    await vi.advanceTimersByTimeAsync(1999);
    expect(h.server.names()).toEqual(['deleteCourse']);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.server.names()).toEqual(['deleteCourse', 'deleteCourse']);
    expect(h.state().outbox[0]?.attempts).toBe(2);
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.state().outbox).toEqual([]);
    expect(h.state().stalled).toBe(false);
  });

  it('retries at once when the network or the page comes back', async () => {
    const h = make({ stored: MINE });
    h.server.rev = 3;
    h.setOnline(false);
    h.store.actions.setSkip({ onDate: '2026-10-19', meetingId: null, skipped: true, label: null });
    await h.store.actions.flush();
    expect(h.server.names()).toEqual([]);
    expect(h.state().stalled).toBe(true);
    h.setOnline(true);
    h.wake();
    await h.store.actions.flush();
    expect(h.server.names()).toContain('setSkip');
    expect(h.state().outbox).toEqual([]);
  });

  it('drops a refused write, tells the member and fetches the truth', async () => {
    const h = make({ stored: MINE });
    h.server.rev = 3;
    h.server.data = snapshot({ rev: 3, courses: [course()] });
    const refusal = new ApiClientError(409, 'id_taken', '这个编号已被使用');
    h.server.failures.push(refusal);
    h.store.actions.saveCourse({ ...course({ id: tid('tc', 'taken') }) });
    await h.store.actions.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.reports).toEqual([refusal]);
    expect(h.state().outbox).toEqual([]);
    expect(h.server.names()).toEqual(['saveCourse', 'get']);
    expect(h.state().snapshot?.courses.map((c) => c.id)).toEqual([course().id]);
  });

  it('fetches again when the rev shows another device wrote', async () => {
    const h = make({ stored: MINE });
    h.server.rev = 5;
    h.server.data = snapshot({ rev: 5, courses: [course()], terms: [term()] });
    h.store.actions.updateSettings({ classReminders: true });
    await h.store.actions.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.server.names()).toEqual(['updateSettings', 'get']);
    expect(h.state().snapshot?.rev).toBe(6);
    expect(h.state().snapshot?.terms).toHaveLength(1);
    expect(h.state().snapshot?.settings.classReminders).toBe(true);
  });

  it('cancels a create and its delete without sending either', async () => {
    const h = make({ stored: MINE });
    h.setOnline(false);
    h.store.actions.saveAssignment({ ...assignment({ id: tid('ta', 'tmp') }) });
    h.store.actions.deleteAssignment(tid('ta', 'tmp'));
    expect(h.state().outbox).toEqual([]);
    h.setOnline(true);
    await h.store.actions.flush();
    expect(h.server.names()).toEqual([]);
  });

  it('imports online and then fetches the result', async () => {
    const h = make({ stored: MINE });
    h.server.rev = 3;
    const counts = await h.store.actions.importAll({ terms: [], courses: [], assignments: [], skips: [] });
    expect(counts).toEqual({ terms: 0, courses: 0, assignments: 0, skips: 0 });
    expect(h.server.names()).toEqual(['importAll', 'get']);
  });

  it('clears and keeps the settings', async () => {
    const h = make({ stored: MINE });
    h.server.rev = 3;
    await h.store.actions.clearAll();
    expect(h.state().snapshot?.courses).toEqual([]);
    expect(h.server.names()).toEqual(['clear']);
  });
});

describe('language', () => {
  it('saves the app language for pushes once there is something to remind', async () => {
    const h = make({ stored: MINE, locale: 'en' });
    h.server.rev = 3;
    await h.store.actions.refresh();
    await h.store.actions.flush();
    expect(h.server.calls.find((call) => call.name === 'updateSettings')?.args).toEqual([{ locale: 'en' }]);
    expect(h.state().snapshot?.settings.locale).toBe('en');
    h.setLocale('zh');
    await h.store.actions.flush();
    expect(h.server.calls.filter((call) => call.name === 'updateSettings').map((call) => call.args[0])).toEqual([{ locale: 'en' }, { locale: 'zh' }]);
  });

  it('writes nothing for an empty timetable', async () => {
    const h = make({ stored: { ...MINE, snapshot: snapshot({ rev: 0 }) }, locale: 'en' });
    await h.store.actions.refresh();
    await h.store.actions.flush();
    expect(h.server.names()).toEqual(['get']);
  });
});
