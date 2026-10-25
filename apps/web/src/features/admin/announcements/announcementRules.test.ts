import { describe, expect, it } from 'vitest';
import type { AdminAnnouncementRow, AdminAnnouncementsResponse } from '@utmmsc/shared';
import { ApiClientError } from '../../../shared/api/errors';
import {
  ANNOUNCEMENT_BODY_MAX,
  announcementMeta,
  announcementsPath,
  appendAnnouncements,
  canSendAnnouncement,
  deliveryText,
  emailSwitchLabel,
  keepLoadedPages,
  newAnnouncementPath,
  previewLines,
  sendMayHaveGoneOut,
  sendTitle,
  sentToast,
  uncertainSendText,
} from './announcementRules';

function row(id: string, extra: Partial<AdminAnnouncementRow> = {}): AdminAnnouncementRow {
  return {
    id,
    title: `公告 ${id}`,
    body: '正文',
    sentAt: '2026-10-24T14:00:00.000Z',
    recipientCount: 128,
    emailed: true,
    sentBy: { id: 'm1', displayName: '张三' },
    ...extra,
  };
}

const relative = { zh: '3 小时前', en: '3 hr ago' };

describe('announcement paths', () => {
  it('builds the history, an item and the compose screen', () => {
    expect(announcementsPath()).toBe('/admin/announcements');
    expect(announcementsPath('an 1')).toBe('/admin/announcements/an%201');
    expect(newAnnouncementPath()).toBe('/admin/announcements/new');
  });
});

describe('history rows', () => {
  it('says when, who and how many were emailed', () => {
    expect(announcementMeta(row('a'), relative)).toEqual({ zh: '3 小时前 · 张三 · 邮件 128 人', en: '3 hr ago · 张三 · Email to 128' });
  });

  it('says plainly when it was only saved', () => {
    expect(announcementMeta(row('a', { emailed: false }), relative).zh).toBe('3 小时前 · 张三 · 仅保存');
    expect(announcementMeta(row('a', { emailed: false }), relative).en).toBe('3 hr ago · 张三 · Saved only');
    expect(deliveryText(row('a', { emailed: false })).zh).toContain('成员看不到');
    expect(deliveryText(row('a', { recipientCount: 1 })).en).toBe("To 1 member. Delivery isn't tracked here.");
  });

  it('says who it was sent to without claiming it arrived', () => {
    // The server writes the row before the mail service answers, so delivery is not known.
    // 服务器在邮件服务答复之前就写入了记录，因此不知道是否送达。
    expect(deliveryText(row('a')).zh).toBe('发给 128 位成员，这里看不到是否送达');
    expect(deliveryText(row('a')).zh).not.toContain('已发');
    expect(announcementMeta(row('a'), relative).en).not.toContain('Emailed');
  });

  it('names a sender who is gone', () => {
    expect(announcementMeta(row('a', { sentBy: null }), relative).en).toBe('3 hr ago · A removed member · Email to 128');
  });
});

describe('preview', () => {
  it('shows the first lines without blank ones', () => {
    expect(previewLines('第一行\n\n第二行\n第三行')).toEqual(['第一行', '第二行', '第三行']);
    expect(previewLines('  \n只有一行  ')).toEqual(['只有一行']);
    expect(previewLines('')).toEqual([]);
  });

  it('marks a cut with an ellipsis', () => {
    expect(previewLines('1\n2\n3\n4')).toEqual(['1', '2', '3…']);
    const long = 'x'.repeat(300);
    const [first] = previewLines(long);
    expect(first).toBe(`${'x'.repeat(240)}…`);
    expect(previewLines(`${'a'.repeat(240)}\nmore`)).toEqual([`${'a'.repeat(240)}…`]);
  });

  it('counts characters as people see them', () => {
    const [first] = previewLines('\u{1F389}'.repeat(250));
    expect(Array.from(first ?? '').length).toBe(241);
  });
});

describe('send copy', () => {
  it('names the count when the summary has it', () => {
    expect(sendTitle(128)).toEqual({ zh: '发送给 128 位成员？', en: 'Send to 128 members?' });
    expect(sendTitle(1).en).toBe('Send to 1 member?');
    expect(sendTitle(undefined).zh).toBe('发送给全体在用成员？');
    expect(emailSwitchLabel(128)).toEqual({ zh: '发送邮件给全体在用成员（128 人）', en: 'Email every active member (128)' });
    expect(emailSwitchLabel(undefined).en).toBe('Email every active member');
  });

  it('needs a title and a message within their limits', () => {
    expect(canSendAnnouncement('标题', '正文')).toBe(true);
    expect(canSendAnnouncement(' ', '正文')).toBe(false);
    expect(canSendAnnouncement('标题', '  ')).toBe(false);
    expect(canSendAnnouncement('x'.repeat(81), '正文')).toBe(false);
    expect(canSendAnnouncement('标题', 'x'.repeat(ANNOUNCEMENT_BODY_MAX + 1))).toBe(false);
  });

  it('says the email is on its way, not that it arrived', () => {
    expect(sentToast({ emailed: true, recipientCount: 128 })).toEqual({ zh: '公告已保存，邮件正在发给 128 位成员', en: 'Saved. Sending email to 128 members.' });
    expect(sentToast({ emailed: false, recipientCount: 128 }).zh).toBe('公告已保存，没有发邮件');
  });
});

describe('a failed send', () => {
  it('may have gone out when there was no answer or the server failed', () => {
    expect(sendMayHaveGoneOut(new TypeError('Failed to fetch'))).toBe(true);
    expect(sendMayHaveGoneOut(new DOMException('The operation was aborted.', 'AbortError'))).toBe(true);
    expect(sendMayHaveGoneOut(new ApiClientError(500, 'internal', '出错了'))).toBe(true);
    expect(sendMayHaveGoneOut(new ApiClientError(503, 'unavailable', '服务暂不可用'))).toBe(true);
  });

  it('did not go out when the server turned it down', () => {
    expect(sendMayHaveGoneOut(new ApiClientError(429, 'rate_limited', '操作太频繁'))).toBe(false);
    expect(sendMayHaveGoneOut(new ApiClientError(400, 'bad_request', '标题不能为空'))).toBe(false);
    expect(sendMayHaveGoneOut(new ApiClientError(403, 'forbidden', '没有权限'))).toBe(false);
  });

  it('tells the admin to check the history before sending again', () => {
    expect(uncertainSendText(true)).toEqual({ zh: '公告可能已发出，请先查看公告记录再重试。', en: 'It may have gone out. Check the history before trying again.' });
    expect(uncertainSendText(false).zh).toBe('公告可能已保存，请先查看公告记录再重试。');
  });
});

describe('paging', () => {
  it('appends the next page without repeats', () => {
    const merged = appendAnnouncements({ announcements: [row('a'), row('b')], nextCursor: 'c1' }, { announcements: [row('b'), row('c')], nextCursor: null });
    expect(merged.announcements.map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(merged.nextCursor).toBeNull();
  });
});

describe('reloading the first page', () => {
  function rows(from: number, to: number): AdminAnnouncementRow[] {
    return Array.from({ length: to - from + 1 }, (_, i) => row(`a${from + i}`));
  }
  const ids = (page: AdminAnnouncementsResponse) => page.announcements.map((item) => item.id);

  it('keeps the older pages already loaded, and their cursor', () => {
    const loaded = { announcements: rows(1, 60), nextCursor: 'c3' };
    const merged = keepLoadedPages({ announcements: rows(1, 20), nextCursor: 'c1' }, loaded);
    expect(merged.announcements).toHaveLength(60);
    expect(ids(merged)[34]).toBe('a35');
    expect(merged.nextCursor).toBe('c3');
  });

  it('puts a new announcement on top without repeating the rows it pushed down', () => {
    const fresh = { announcements: [row('new'), ...rows(1, 19)], nextCursor: 'c1b' };
    const merged = keepLoadedPages(fresh, { announcements: rows(1, 40), nextCursor: 'c2' });
    expect(ids(merged)).toEqual(['new', ...rows(1, 40).map((item) => item.id)]);
    expect(merged.nextCursor).toBe('c2');
  });

  it('keeps the place after one page too, so a page still loading still fits', () => {
    const fresh = { announcements: [row('new'), ...rows(1, 19)], nextCursor: 'c1b' };
    const merged = keepLoadedPages(fresh, { announcements: rows(1, 20), nextCursor: 'c1' });
    expect(ids(merged).at(-1)).toBe('a20');
    expect(merged.nextCursor).toBe('c1');
  });

  it('uses the fresh page alone when it does not reach the loaded rows', () => {
    const fresh = { announcements: Array.from({ length: 20 }, (_, i) => row(`n${i}`)), nextCursor: 'cn' };
    expect(keepLoadedPages(fresh, { announcements: rows(1, 40), nextCursor: 'c2' })).toBe(fresh);
  });

  it('uses the fresh page alone when nothing was loaded past it', () => {
    const fresh = { announcements: rows(1, 20), nextCursor: 'c1' };
    expect(keepLoadedPages(fresh, { announcements: rows(1, 20), nextCursor: 'c1' })).toBe(fresh);
    expect(keepLoadedPages(fresh, undefined)).toBe(fresh);
  });
});
