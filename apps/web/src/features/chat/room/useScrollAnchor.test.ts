import { describe, expect, it } from 'vitest';
import { JOIN_TIP_KEY, UNREAD_MARKER_KEY, messageKey, pendingKey } from './timeline';
import { isAnchorKey, isMomentumOverride } from './useScrollAnchor';

describe('isAnchorKey', () => {
  it('anchors on message rows only', () => {
    expect(isAnchorKey('m:41')).toBe(true);
    expect(isAnchorKey(pendingKey('abc'))).toBe(true);
    expect(isAnchorKey('d:m:41')).toBe(false);
    expect(isAnchorKey(UNREAD_MARKER_KEY)).toBe(false);
    expect(isAnchorKey(JOIN_TIP_KEY)).toBe(false);
  });

  it('accepts every key the timeline gives a message', () => {
    const base = { id: 7, roomId: 'channel:ch', text: '', imageKey: null, createdAt: '2026-01-01T00:00:00.000Z', deleted: false, recalled: false };
    const message = { ...base, author: { id: 'me', displayName: 'Me' }, kind: 'user' as const, system: null, replyTo: null, imageWidth: null, imageHeight: null, thumbKey: null, deletedBy: null, rev: 0 };
    expect(isAnchorKey(messageKey({ ...message, clientId: 'c1' }, 'me'))).toBe(true);
    expect(isAnchorKey(messageKey({ ...message, clientId: null }, 'me'))).toBe(true);
  });
});

describe('isMomentumOverride', () => {
  it('detects momentum carrying on from before the restore', () => {
    // An upward fling at 20px per frame, then a 3000px page restored above the reader.
    // 以每帧 20px 向上滑动，随后在阅读位置上方恢复了一页 3000px 的内容。
    expect(isMomentumOverride(-3020, 3000, -20, false)).toBe(true);
    expect(isMomentumOverride(-74, 44, -30, false)).toBe(true);
  });

  it('treats a step at the earlier speed as the member scrolling on', () => {
    expect(isMomentumOverride(-20, 3000, -20, false)).toBe(false);
    expect(isMomentumOverride(-28, 44, -30, false)).toBe(false);
    expect(isMomentumOverride(0, 44, 0, false)).toBe(false);
  });

  it('never treats input-driven steps as an override', () => {
    expect(isMomentumOverride(-3020, 3000, -20, true)).toBe(false);
  });

  it('ignores steps once no restore is waiting', () => {
    expect(isMomentumOverride(-3020, 0, -20, false)).toBe(false);
  });
});
