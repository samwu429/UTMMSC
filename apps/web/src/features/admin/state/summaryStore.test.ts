import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AdminSummaryResponse, MemberSelf } from '@utmmsc/shared';
import { ApiClientError } from '../../../shared/api/errors';
import { useSessionStore } from '../../../shared/session/store';
import { SUMMARY_MIN_GAP_MS, bindAdminSummaryToSession, createAdminSummaryStore, type AdminSummaryApi } from './summaryStore';

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

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function fakeApi() {
  const calls: Deferred<AdminSummaryResponse>[] = [];
  const api: AdminSummaryApi = {
    summary: () => {
      const reply = deferred<AdminSummaryResponse>();
      calls.push(reply);
      return reply.promise;
    },
  };
  return { api, calls };
}

function summary(counts: AdminSummaryResponse['counts']): AdminSummaryResponse {
  return { sections: ['review', 'reports'], counts };
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

describe('admin summary store', () => {
  let clock = 5_000_000;
  const now = () => clock;

  beforeEach(() => {
    clock = 5_000_000;
    useSessionStore.setState({ token: 'tok', member: member(), mediaToken: null });
  });

  afterEach(() => {
    useSessionStore.setState({ token: null, member: null, mediaToken: null });
  });

  it('loads the counts and shares answers that are still recent', async () => {
    const { api, calls } = fakeApi();
    const store = createAdminSummaryStore(api, now);
    const first = store.getState().refresh();
    calls[0]!.resolve(summary({ pendingApplications: 3, openReports: 1 }));
    await first;
    expect(store.getState()).toMatchObject({ status: 'ready', loading: false, counts: { pendingApplications: 3, openReports: 1 } });

    clock += SUMMARY_MIN_GAP_MS - 1;
    await store.getState().refresh();
    expect(calls).toHaveLength(1);
    clock += 1;
    void store.getState().refresh();
    expect(calls).toHaveLength(2);
  });

  it('hides the counts when the server has no summary yet', async () => {
    const { api, calls } = fakeApi();
    const store = createAdminSummaryStore(api, now);
    const first = store.getState().refresh();
    calls[0]!.reject(new ApiClientError(404, 'not_found', '接口不存在'));
    await first;
    expect(store.getState()).toMatchObject({ status: 'unavailable', counts: {} });
  });

  it('keeps the last counts when a refresh fails', async () => {
    const { api, calls } = fakeApi();
    const store = createAdminSummaryStore(api, now);
    const first = store.getState().refresh();
    calls[0]!.resolve(summary({ openReports: 2 }));
    await first;
    const second = store.getState().refresh({ force: true });
    calls[1]!.reject(new TypeError('offline'));
    await second;
    expect(store.getState()).toMatchObject({ status: 'ready', counts: { openReports: 2 } });
  });

  it('a forced refresh during a request asks again afterwards', async () => {
    const { api, calls } = fakeApi();
    const store = createAdminSummaryStore(api, now);
    void store.getState().refresh();
    void store.getState().refresh({ force: true });
    expect(calls).toHaveLength(1);
    calls[0]!.resolve(summary({ pendingApplications: 3 }));
    await flush();
    expect(calls).toHaveLength(2);
    calls[1]!.resolve(summary({ pendingApplications: 2 }));
    await flush();
    expect(store.getState().counts.pendingApplications).toBe(2);
    expect(store.getState().loading).toBe(false);
  });

  it('adjusts a count at once, and an older answer does not undo it', async () => {
    const { api, calls } = fakeApi();
    const store = createAdminSummaryStore(api, now);
    const first = store.getState().refresh();
    calls[0]!.resolve(summary({ pendingApplications: 3 }));
    await first;

    void store.getState().refresh({ force: true });
    store.getState().adjust('pendingApplications', -1);
    expect(store.getState().counts.pendingApplications).toBe(2);
    // This answer started before the approval was counted, so it is dropped and asked again.
    // 这个结果在计入那次通过之前就已发出，因此被丢弃并重新查询。
    calls[1]!.resolve(summary({ pendingApplications: 3 }));
    await flush();
    expect(store.getState().counts.pendingApplications).toBe(2);
    expect(calls).toHaveLength(3);
    calls[2]!.resolve(summary({ pendingApplications: 2 }));
    await flush();
    expect(store.getState().counts.pendingApplications).toBe(2);

    store.getState().adjust('pendingApplications', -5);
    expect(store.getState().counts.pendingApplications).toBe(0);
    store.getState().adjust('openReports', -1);
    expect(store.getState().counts.openReports).toBeUndefined();
  });

  it('asks nothing while signed out', async () => {
    const { api, calls } = fakeApi();
    const store = createAdminSummaryStore(api, now);
    useSessionStore.setState({ token: null, member: null });
    await store.getState().refresh({ force: true });
    expect(calls).toHaveLength(0);
  });

  it('resets on sign-out and when the viewed role changes, dropping answers on their way', async () => {
    const { api, calls } = fakeApi();
    const store = createAdminSummaryStore(api, now);
    const stop = bindAdminSummaryToSession(store);
    const first = store.getState().refresh();
    calls[0]!.resolve(summary({ openReports: 4 }));
    await first;

    void store.getState().refresh({ force: true });
    useSessionStore.getState().setMember(member({ realRole: 'superadmin', role: 'head_events', actingRole: 'head_events' }));
    expect(store.getState()).toMatchObject({ status: 'idle', counts: {} });
    calls[1]!.resolve(summary({ openReports: 4 }));
    await flush();
    expect(store.getState().counts).toEqual({});

    const again = store.getState().refresh();
    calls[2]!.resolve(summary({ upcomingEvents: 2 }));
    await again;
    useSessionStore.getState().clear();
    expect(store.getState()).toMatchObject({ status: 'idle', counts: {} });
    stop();
  });
});
