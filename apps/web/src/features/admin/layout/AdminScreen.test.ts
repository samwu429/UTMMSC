import { describe, expect, it } from 'vitest';
import { isAdminPath, isDetailTarget } from './AdminScreen';

describe('back targets', () => {
  it('tells admin paths from the rest of the app', () => {
    expect(isAdminPath('/admin')).toBe(true);
    expect(isAdminPath('/admin/channels')).toBe(true);
    expect(isAdminPath('/admin?tab=channels')).toBe(true);
    expect(isAdminPath('/administer')).toBe(false);
    expect(isAdminPath('/chat/room/r1/info')).toBe(false);
  });

  it('keeps the back button in the detail pane only for screens under another detail screen', () => {
    // A channel editor goes back to the channel's settings, a role picker to the member: the list beside the pane
    // shows neither.
    // 频道编辑界面返回频道设置，身份选择返回该成员：旁边的列表里都没有。
    expect(isDetailTarget('/admin/channels/ch_1')).toBe(true);
    expect(isDetailTarget('/admin/members/mem_1?from=list')).toBe(true);
    // A first-level detail goes back to its section's list, which is the pane beside it.
    // 一级详情返回所在板块的列表，也就是它旁边的那一栏。
    expect(isDetailTarget('/admin/channels')).toBe(false);
    expect(isDetailTarget('/admin/channels/')).toBe(false);
    expect(isDetailTarget('/admin/review?segment=year')).toBe(false);
    expect(isDetailTarget('/admin')).toBe(false);
    expect(isDetailTarget('/chat/room/r1/info')).toBe(false);
  });
});
