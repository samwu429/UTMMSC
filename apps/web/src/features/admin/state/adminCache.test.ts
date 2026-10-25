import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MemberSelf } from '@utmmsc/shared';
import { useSessionStore } from '../../../shared/session/store';
import { DEFAULT_STALE_MS, bindAdminCacheToSession, createAdminCache } from './adminCache';

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A loader whose every call waits until the test answers it. */
/** 每次调用都等测试给出回复的加载函数。 */
function fakeLoader<T>() {
  const calls: Deferred<T>[] = [];
  return {
    calls,
    load: () => {
      const reply = deferred<T>();
      calls.push(reply);
      return reply.promise;
    },
  };
}

function member(extra: Partial<MemberSelf> = {}): MemberSelf {
  return {
    id: 'mem_a',
    displayName: 'A',
    role: 'president',
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
    realRole: 'president',
    actingRole: null,
    ...extra,
  };
}

describe('admin cache', () => {
  let clock = 1_000_000;
  const now = () => clock;

  beforeEach(() => {
    clock = 1_000_000;
  });

  it('fetches once, then serves the fresh copy without calling the loader', async () => {
    const cache = createAdminCache(now);
    const loader = fakeLoader<string[]>();
    const first = cache.load('members', loader.load);
    expect(cache.read('members').loading).toBe(true);
    loader.calls[0]!.resolve(['a']);
    await expect(first).resolves.toEqual(['a']);
    expect(cache.read('members')).toMatchObject({ data: ['a'], loading: false, error: null, stale: false });

    clock += DEFAULT_STALE_MS - 1;
    await expect(cache.load('members', loader.load)).resolves.toEqual(['a']);
    expect(loader.calls).toHaveLength(1);
  });

  it('keeps showing old data while it refetches once the data is stale', async () => {
    const cache = createAdminCache(now);
    const loader = fakeLoader<string[]>();
    const first = cache.load('members', loader.load);
    loader.calls[0]!.resolve(['a']);
    await first;

    clock += DEFAULT_STALE_MS;
    const again = cache.load('members', loader.load);
    expect(loader.calls).toHaveLength(2);
    expect(cache.read('members')).toMatchObject({ data: ['a'], loading: true });
    loader.calls[1]!.resolve(['a', 'b']);
    await again;
    expect(cache.read('members').data).toEqual(['a', 'b']);
  });

  it('shares a load in flight, and a forced load wins over an older one', async () => {
    const cache = createAdminCache(now);
    const loader = fakeLoader<number>();
    const one = cache.load('summary', loader.load);
    const two = cache.load('summary', loader.load);
    expect(loader.calls).toHaveLength(1);
    expect(two).toBe(one);

    const forced = cache.load('summary', loader.load, { force: true });
    expect(loader.calls).toHaveLength(2);
    loader.calls[1]!.resolve(2);
    await forced;
    loader.calls[0]!.resolve(1);
    await one;
    expect(cache.read('summary').data).toBe(2);
  });

  it('keeps the last data after a failure, and the next success clears the error', async () => {
    const cache = createAdminCache(now);
    const loader = fakeLoader<string>();
    const first = cache.load('invites', loader.load);
    loader.calls[0]!.resolve('one');
    await first;

    const failing = cache.load('invites', loader.load, { force: true });
    const problem = new Error('offline');
    loader.calls[1]!.reject(problem);
    await expect(failing).resolves.toBe('one');
    expect(cache.read('invites')).toMatchObject({ data: 'one', error: problem, loading: false });

    const retry = cache.load('invites', loader.load, { force: true });
    loader.calls[2]!.resolve('two');
    await retry;
    expect(cache.read('invites')).toMatchObject({ data: 'two', error: null });
  });

  it('mutates locally and tells subscribers; a load in flight before the change is dropped', async () => {
    const cache = createAdminCache(now);
    const loader = fakeLoader<string[]>();
    const first = cache.load('applications', loader.load);
    loader.calls[0]!.resolve(['a', 'b']);
    await first;

    let calls = 0;
    const stop = cache.subscribe('applications', () => {
      calls += 1;
    });
    cache.mutate<string[]>('applications', (current) => (current ?? []).filter((id) => id !== 'a'));
    expect(cache.read('applications').data).toEqual(['b']);
    expect(calls).toBe(1);

    const racing = cache.load('applications', loader.load, { force: true });
    cache.mutate<string[]>('applications', (current) => [...(current ?? []), 'c']);
    loader.calls[1]!.resolve(['a', 'b']);
    await racing;
    // The answer predates the mutation, so the local change stays and the key is marked for another load.
    // 这个结果早于修改，因此本地改动保留，并把这个键标为需要再次加载。
    expect(cache.read('applications')).toMatchObject({ data: ['b', 'c'], stale: true });
    stop();
  });

  it('invalidates by key or by test, so the next load fetches again', async () => {
    const cache = createAdminCache(now);
    const loader = fakeLoader<string>();
    for (const key of ['reports:open', 'reports:removed', 'members']) {
      const pending = cache.load(key, loader.load);
      loader.calls[loader.calls.length - 1]!.resolve(key);
      await pending;
    }
    cache.invalidate((key) => key.startsWith('reports:'));
    expect(cache.read('reports:open').stale).toBe(true);
    expect(cache.read('reports:removed').stale).toBe(true);
    expect(cache.read('members').stale).toBe(false);
    expect(cache.isFresh('reports:open', DEFAULT_STALE_MS)).toBe(false);

    void cache.load('reports:open', loader.load);
    expect(loader.calls).toHaveLength(4);
    expect(cache.read('reports:open').data).toBe('reports:open');
  });

  it('drops a load in flight when its key is invalidated', async () => {
    const cache = createAdminCache(now);
    const loader = fakeLoader<string>();
    const early = cache.load('reports:removed', loader.load);
    cache.invalidate('reports:removed');
    loader.calls[0]!.resolve('old');
    await early;
    expect(cache.read('reports:removed').data).toBeUndefined();
    expect(cache.read('reports:removed').stale).toBe(true);
  });

  it('clear empties everything and ignores answers still on their way', async () => {
    const cache = createAdminCache(now);
    const loader = fakeLoader<string>();
    const done = cache.load('members', loader.load);
    loader.calls[0]!.resolve('first member');
    await done;
    const inflight = cache.load('channels', loader.load);

    let told = 0;
    cache.subscribe('members', () => {
      told += 1;
    });
    cache.clear();
    expect(told).toBe(1);
    expect(cache.read('members').data).toBeUndefined();

    loader.calls[1]!.resolve('previous member');
    await inflight;
    expect(cache.read('channels').data).toBeUndefined();
  });
});

describe('admin cache and the session', () => {
  beforeEach(() => {
    useSessionStore.setState({ token: 'tok', member: member(), mediaToken: null });
  });

  afterEach(() => {
    useSessionStore.setState({ token: null, member: null, mediaToken: null });
  });

  async function filled() {
    const cache = createAdminCache();
    const pending = cache.load('members', () => Promise.resolve(['x']));
    await pending;
    return cache;
  }

  it('empties on sign-out', async () => {
    const cache = await filled();
    const stop = bindAdminCacheToSession(cache);
    useSessionStore.getState().clear();
    expect(cache.read('members').data).toBeUndefined();
    stop();
  });

  it('empties when another member signs in', async () => {
    const cache = await filled();
    const stop = bindAdminCacheToSession(cache);
    useSessionStore.getState().setMember(member({ id: 'mem_b' }));
    expect(cache.read('members').data).toBeUndefined();
    stop();
  });

  it('empties when the viewed role changes, and keeps data for other member updates', async () => {
    const cache = await filled();
    const stop = bindAdminCacheToSession(cache);
    useSessionStore.getState().setMember(member({ displayName: 'A again' }));
    expect(cache.read('members').data).toEqual(['x']);
    useSessionStore.getState().setMember(member({ role: 'head_events', actingRole: 'head_events', realRole: 'superadmin' }));
    expect(cache.read('members').data).toBeUndefined();
    stop();
  });
});
