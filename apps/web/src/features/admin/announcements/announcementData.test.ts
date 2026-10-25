import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminAnnouncementRow, AdminAnnouncementsResponse } from '@utmmsc/shared';
import { ApiClientError } from '../../../shared/api/errors';
import { adminCache } from '../state/adminCache';
import { ANNOUNCEMENTS_KEY, loadAnnouncementHistory, loadMoreAnnouncements, type AnnouncementHistory } from './announcementData';

/**
 * The history loader and load more against the real admin cache, with the admin API replaced.
 * 用真实的管理后台缓存测试记录的加载函数和「加载更多」，管理接口换成替身。
 */
const api = vi.hoisted(() => ({ announcements: vi.fn<(cursor?: string) => Promise<AdminAnnouncementsResponse>>() }));

vi.mock('../api', () => ({ adminApi: api }));

function row(id: string): AdminAnnouncementRow {
  return { id, title: `公告 ${id}`, body: '正文', sentAt: '2026-10-24T14:00:00.000Z', recipientCount: 10, emailed: true, sentBy: null };
}

function rows(from: number, to: number): AdminAnnouncementRow[] {
  return Array.from({ length: to - from + 1 }, (_, i) => row(`a${from + i}`));
}

function history(): AnnouncementHistory | undefined {
  return adminCache.read<AnnouncementHistory>(ANNOUNCEMENTS_KEY).data;
}

function seed(page: AnnouncementHistory): void {
  adminCache.mutate<AnnouncementHistory>(ANNOUNCEMENTS_KEY, () => page);
}

/** What the history screen does when it mounts after the data went stale, or after load more marked it. */
/** 数据过期之后，或被「加载更多」标记之后，记录界面挂载时所做的事。 */
function reload(): Promise<AnnouncementHistory | undefined> {
  return adminCache.load(ANNOUNCEMENTS_KEY, loadAnnouncementHistory, { force: true });
}

beforeEach(() => {
  api.announcements.mockReset();
});

afterEach(() => {
  adminCache.clear();
});

describe('announcement history', () => {
  it('keeps rows past the first page when a row is opened after 30 s', async () => {
    seed({ announcements: rows(1, 60), nextCursor: 'c3', unavailable: false });
    api.announcements.mockResolvedValueOnce({ announcements: rows(1, 20), nextCursor: 'c1' });
    await reload();
    expect(history()?.announcements).toHaveLength(60);
    expect(history()?.announcements.find((item) => item.id === 'a35')).toBeDefined();
    expect(history()?.nextCursor).toBe('c3');
  });

  it('keeps a page that load more added while the first page was on its way', async () => {
    seed({ announcements: rows(1, 20), nextCursor: 'c1', unavailable: false });
    let answer!: (page: AdminAnnouncementsResponse) => void;
    api.announcements.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    const first = reload();
    api.announcements.mockResolvedValueOnce({ announcements: rows(21, 40), nextCursor: 'c2' });
    await loadMoreAnnouncements('c1');
    // Load more dropped the reload in flight and marked the history stale, so the screen loads it again.
    // 「加载更多」丢弃了途中的重新加载并把记录标为过期，界面因此再次加载。
    expect(adminCache.read(ANNOUNCEMENTS_KEY).stale).toBe(true);
    answer({ announcements: rows(1, 20), nextCursor: 'c1' });
    await first;
    api.announcements.mockResolvedValueOnce({ announcements: rows(1, 20), nextCursor: 'c1' });
    await reload();
    expect(history()?.announcements).toHaveLength(40);
    expect(history()?.nextCursor).toBe('c2');
  });

  it('puts a new announcement on top of the loaded pages', async () => {
    seed({ announcements: rows(1, 40), nextCursor: 'c2', unavailable: false });
    api.announcements.mockResolvedValueOnce({ announcements: [row('new'), ...rows(1, 19)], nextCursor: 'c1b' });
    await reload();
    expect(history()?.announcements.map((item) => item.id)).toEqual(['new', ...rows(1, 40).map((item) => item.id)]);
    expect(history()?.nextCursor).toBe('c2');
  });

  it('does not add a page at a cursor the history no longer ends at', async () => {
    seed({ announcements: [row('new'), ...rows(1, 19)], nextCursor: 'c1b', unavailable: false });
    api.announcements.mockResolvedValueOnce({ announcements: rows(21, 40), nextCursor: 'c2' });
    await loadMoreAnnouncements('c1');
    expect(history()?.announcements).toHaveLength(20);
    expect(history()?.nextCursor).toBe('c1b');
  });

  it('says the history is unavailable on a server without it', async () => {
    api.announcements.mockRejectedValueOnce(new ApiClientError(404, 'not_found', '接口不存在'));
    await reload();
    expect(history()).toEqual({ announcements: [], nextCursor: null, unavailable: true });
  });

  it('starts fresh after an unavailable history', async () => {
    seed({ announcements: [], nextCursor: null, unavailable: true });
    api.announcements.mockResolvedValueOnce({ announcements: rows(1, 3), nextCursor: null });
    await reload();
    expect(history()).toEqual({ announcements: rows(1, 3), nextCursor: null, unavailable: false });
  });
});
