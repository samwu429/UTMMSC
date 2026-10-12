import { describe, expect, it } from 'vitest';
import { friendshipState } from './friends';

describe('friendship state', () => {
  it('lets a pending request be accepted from the other side and ignores rejections', () => {
    expect(friendshipState('a', 'a', [])).toBe('self');
    expect(friendshipState('a', 'b', [])).toBe('none');
    expect(friendshipState('a', 'b', [{ fromId: 'a', toId: 'b', status: 'pending' }])).toBe('outgoing');
    expect(friendshipState('b', 'a', [{ fromId: 'a', toId: 'b', status: 'pending' }])).toBe('incoming');
    expect(friendshipState('a', 'b', [{ fromId: 'a', toId: 'b', status: 'accepted' }])).toBe('friends');
    expect(friendshipState('a', 'b', [{ fromId: 'a', toId: 'b', status: 'rejected' }])).toBe('none');
  });
});
