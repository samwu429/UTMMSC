import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminMemberRow, Role } from '@utmmsc/shared';
import { adminApi } from '../api';
import { adminCache } from '../state/adminCache';
import { MEMBERS_KEY, cachedMember, restoreRole } from './memberData';

/** The request helper under adminApi, so a test sees the path and the body that would go out. */
/** adminApi 底下的请求函数，测试因此能看到将要发出的路径和请求体。 */
const client = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../../../shared/api/client', () => client);

function person(id: string, role: Role, extra: Partial<AdminMemberRow> = {}): AdminMemberRow {
  return {
    id,
    displayName: id,
    role,
    enrollmentStatus: role === 'alumni' || role.startsWith('honorary') ? 'alumni' : 'student',
    graduationYear: 2024,
    major: null,
    headline: null,
    about: null,
    location: null,
    skills: [],
    openTo: [],
    avatarKey: null,
    coverKey: null,
    email: `${id}@mail.utoronto.ca`,
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...extra,
  };
}

/** The JSON body of the n-th request, as it goes on the wire. */
/** 第 n 个请求的 JSON 请求体，即实际发出的内容。 */
const sentBody = (n = 0) => JSON.stringify((client.api.mock.calls[n]?.[1] as { body?: unknown } | undefined)?.body);

beforeEach(() => {
  client.api.mockReset();
  adminCache.clear();
  // A department head just set to 毕业生, which moved their enrollment to alumni as well.
  // 一位部长刚被改为毕业生，在读状态也随之变为毕业生。
  adminCache.mutate<AdminMemberRow[]>(MEMBERS_KEY, () => [person('head', 'alumni'), person('other', 'student')]);
});

describe('restoreRole', () => {
  it('sends the old role with the status from before the change, and stores both', async () => {
    client.api.mockResolvedValue({ ok: true, role: 'head_events', enrollmentStatus: 'student' });
    await restoreRole('head', 'head_events', 'student');
    expect(client.api).toHaveBeenCalledTimes(1);
    expect(client.api.mock.calls[0]?.[0]).toBe('/admin/members/head/role');
    expect(sentBody()).toBe('{"role":"head_events","enrollmentStatus":"student"}');
    expect(cachedMember('head')).toMatchObject({ role: 'head_events', enrollmentStatus: 'student' });
    expect(cachedMember('other')).toMatchObject({ role: 'student', enrollmentStatus: 'student' });
  });

  it('stores the status the server answers when it differs', async () => {
    // Five years after enrollment the server keeps 毕业生.
    // 入学满五年后服务器保留毕业生。
    client.api.mockResolvedValue({ ok: true, role: 'head_events', enrollmentStatus: 'alumni' });
    await restoreRole('head', 'head_events', 'student');
    expect(cachedMember('head')).toMatchObject({ role: 'head_events', enrollmentStatus: 'alumni' });
  });

  it('leaves the cache alone when the request fails', async () => {
    client.api.mockRejectedValue(new TypeError('offline'));
    await expect(restoreRole('head', 'head_events', 'student')).rejects.toThrow('offline');
    expect(cachedMember('head')).toMatchObject({ role: 'alumni', enrollmentStatus: 'alumni' });
  });
});

describe('adminApi.setRole', () => {
  it('sends only the role when no status is given, as before', async () => {
    client.api.mockResolvedValue({ ok: true });
    await adminApi.setRole('m 1', 'alumni');
    expect(client.api.mock.calls[0]?.[0]).toBe('/admin/members/m%201/role');
    expect(sentBody()).toBe('{"role":"alumni"}');
  });
});
