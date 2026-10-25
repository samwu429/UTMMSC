import { describe, expect, it } from 'vitest';
import { ROLES, adminSectionsFor } from '@utmmsc/shared';
import {
  LEGACY_TABS,
  adminLanding,
  legacyAdminPath,
  overviewFacts,
  pendingItems,
  plural,
  quickActionsFor,
  sectionBackTarget,
  sectionOfPath,
  sectionPath,
  sectionValue,
} from './sections';

describe('old ?tab= links', () => {
  it('sends every old tab to its new section', () => {
    expect(legacyAdminPath('?tab=approvals')).toBe('/admin/review');
    expect(legacyAdminPath('?tab=roles')).toBe('/admin/members');
    expect(legacyAdminPath('?tab=advisors')).toBe('/admin/advisors');
    expect(legacyAdminPath('?tab=channels')).toBe('/admin/channels');
    expect(legacyAdminPath('?tab=events')).toBe('/admin/events');
    expect(legacyAdminPath('?tab=announcements')).toBe('/admin/announcements');
    expect(legacyAdminPath('?tab=moments')).toBe('/admin/reports');
    expect(Object.keys(LEGACY_TABS)).toHaveLength(7);
  });

  it('opens one channel from chat info, with the id kept safe in the path', () => {
    expect(legacyAdminPath('?tab=channels&channel=ch_abc')).toBe('/admin/channels/ch_abc');
    expect(legacyAdminPath('?channel=a%2Fb&tab=channels')).toBe('/admin/channels/a%2Fb');
    expect(legacyAdminPath('?tab=channels&channel=')).toBe('/admin/channels');
    // channel= only means something for the channels tab.
    // channel= 只对频道标签有意义。
    expect(legacyAdminPath('?tab=events&channel=ch_abc')).toBe('/admin/events');
  });

  it('leaves an address without a tab alone, and sends an unknown tab to the overview', () => {
    expect(legacyAdminPath('')).toBeNull();
    expect(legacyAdminPath('?q=zhang')).toBeNull();
    expect(legacyAdminPath('?tab=nope')).toBe('/admin');
    expect(legacyAdminPath('?tab=toString')).toBe('/admin');
  });
});

describe('admin paths', () => {
  it('finds the section of a path, including its item screens', () => {
    expect(sectionOfPath('/admin')).toBeNull();
    expect(sectionOfPath('/admin/members')).toBe('members');
    expect(sectionOfPath('/admin/members/mem_1/role')).toBe('members');
    expect(sectionOfPath('/admin/review/applications/app_1')).toBe('review');
    expect(sectionOfPath('/admin/reportsx')).toBeNull();
    expect(sectionOfPath('/discover')).toBeNull();
  });

  it('lands a role with one section straight in it, and everyone else on the overview', () => {
    expect(adminLanding('head_events')).toBe('/admin/events');
    expect(adminLanding('president')).toBeNull();
    expect(adminLanding('secretary_general')).toBeNull();
    expect(adminLanding('superadmin')).toBeNull();
    for (const role of ROLES) {
      if (adminSectionsFor(role).length === 1) expect(adminLanding(role)).toBe(sectionPath(adminSectionsFor(role)[0]!));
    }
  });
});

describe('section back buttons', () => {
  it('go to the overview, or to 发现 for a role with one section', () => {
    expect(sectionBackTarget('president')).toEqual({ to: '/admin', zh: '管理', en: 'Admin' });
    expect(sectionBackTarget('superadmin').to).toBe('/admin');
    expect(sectionBackTarget('head_events')).toEqual({ to: '/discover', zh: '发现', en: 'Discover' });
  });
});

describe('quick actions', () => {
  it('offers only what the viewed role may do', () => {
    expect(quickActionsFor('head_events').map((a) => a.key)).toEqual(['event']);
    expect(quickActionsFor('secretary_general').map((a) => a.key)).toEqual(['announcement']);
    expect(quickActionsFor('president').map((a) => a.key)).toEqual(['event', 'announcement', 'channel']);
    expect(quickActionsFor('superadmin').map((a) => a.key)).toEqual(['event', 'announcement', 'channel', 'advisor']);
    expect(quickActionsFor('student')).toEqual([]);
  });
});

describe('overview words', () => {
  it('lists only the counts with work waiting, in review then reports order', () => {
    expect(pendingItems({})).toEqual([]);
    expect(pendingItems({ pendingApplications: 0, openReports: 0, activeMembers: 40 })).toEqual([]);
    const items = pendingItems({ openReports: 2, pendingApplications: 3, pendingYearRequests: 1 });
    expect(items.map((item) => [item.key, item.count, item.path])).toEqual([
      ['pendingApplications', 3, '/admin/review?type=applications'],
      ['pendingYearRequests', 1, '/admin/review?type=years'],
      ['openReports', 2, '/admin/reports'],
    ]);
    expect(items[0]).toMatchObject({ zh: '3 个入会申请待审核', en: '3 applications waiting' });
    expect(items[1]).toMatchObject({ zh: '1 个入学年份申请待审核', en: '1 enrollment year request waiting' });
    expect(items[2]).toMatchObject({ zh: '2 条动态投诉待处理', en: '2 reports open' });
  });

  it('puts a value beside a section only when there is one to show', () => {
    expect(sectionValue('members', { activeMembers: 128 })).toEqual({ zh: '128 人', en: '128 members' });
    expect(sectionValue('members', {})).toBeNull();
    expect(sectionValue('advisors', { openInvites: 2 })).toEqual({ zh: '2 个未使用', en: '2 unused' });
    expect(sectionValue('advisors', { openInvites: 0 })).toBeNull();
    expect(sectionValue('channels', { channels: 9 })).toEqual({ zh: '9 个', en: '9' });
    expect(sectionValue('events', { upcomingEvents: 2 })).toEqual({ zh: '2 个即将开始', en: '2 upcoming' });
    expect(sectionValue('events', { upcomingEvents: 0 })).toBeNull();
    expect(sectionValue('announcements', { announcementRecipients: 100 })).toBeNull();
    expect(sectionValue('review', { pendingApplications: 3 })).toBeNull();
  });

  it('builds the 概况 line from the counts the role has', () => {
    expect(overviewFacts({ activeMembers: 128, channels: 9, upcomingEvents: 1 })).toEqual([
      { zh: '成员 128', en: '128 members' },
      { zh: '频道 9', en: '9 channels' },
      { zh: '即将开始的活动 1', en: '1 upcoming event' },
    ]);
    expect(overviewFacts({ upcomingEvents: 0 })).toEqual([{ zh: '即将开始的活动 0', en: '0 upcoming events' }]);
    expect(overviewFacts({})).toEqual([]);
  });

  it('says one and many in English', () => {
    expect(plural(1, 'member', 'members')).toBe('1 member');
    expect(plural(0, 'member', 'members')).toBe('0 members');
    expect(plural(12, 'member', 'members')).toBe('12 members');
  });
});
