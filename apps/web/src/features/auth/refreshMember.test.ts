import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MemberSelf } from '@utmmsc/shared';
import { useSessionStore } from '../../shared/session/store';
import { MEMBER_REFRESH_GAP_MS, createMemberRefresher } from './refreshMember';

interface Reply {
  resolve: (role: MemberSelf['role']) => void;
}

function fakeMe() {
  const replies: Reply[] = [];
  const fetchMe = () =>
    new Promise<{ member: MemberSelf; mediaToken: string }>((resolve) => {
      replies.push({ resolve: (role) => resolve({ member: { id: 'mem_me', role } as MemberSelf, mediaToken: `media-${replies.length}` }) });
    });
  return { fetchMe, replies };
}

describe('refreshMember', () => {
  let clock = 1_000_000;
  const now = () => clock;

  beforeEach(() => {
    clock = 1_000_000;
    useSessionStore.setState({ token: 'tok', member: { id: 'mem_me', role: 'student' } as MemberSelf, mediaToken: null });
  });

  afterEach(() => {
    useSessionStore.setState({ token: null, member: null, mediaToken: null });
  });

  it('stores the fresh member and waits a minute between unforced refreshes', async () => {
    const { fetchMe, replies } = fakeMe();
    const refresh = createMemberRefresher(fetchMe, now);
    const first = refresh();
    replies[0]?.resolve('president');
    await first;
    expect(useSessionStore.getState().member?.role).toBe('president');
    expect(useSessionStore.getState().mediaToken).toBe('media-1');

    clock += MEMBER_REFRESH_GAP_MS - 1;
    await refresh();
    expect(replies).toHaveLength(1);

    clock += 1;
    void refresh();
    expect(replies).toHaveLength(2);
  });

  it('shares a refresh in flight but runs a forced one again after it', async () => {
    const { fetchMe, replies } = fakeMe();
    const refresh = createMemberRefresher(fetchMe, now);
    const first = refresh();
    const shared = refresh();
    const forced = refresh({ force: true });
    const forcedAgain = refresh({ force: true });
    expect(replies).toHaveLength(1);
    replies[0]?.resolve('student');
    await Promise.all([first, shared]);
    await Promise.resolve();
    expect(replies).toHaveLength(2);
    replies[1]?.resolve('alumni');
    await Promise.all([forced, forcedAgain]);
    expect(replies).toHaveLength(2);
    expect(useSessionStore.getState().member?.role).toBe('alumni');
  });

  it('drops a reply that arrives after the session ended', async () => {
    const { fetchMe, replies } = fakeMe();
    const refresh = createMemberRefresher(fetchMe, now);
    const pending = refresh({ force: true });
    useSessionStore.setState({ token: null, member: null });
    replies[0]?.resolve('president');
    await pending;
    expect(useSessionStore.getState().member).toBeNull();
  });

  it('does nothing without a session', async () => {
    const { fetchMe, replies } = fakeMe();
    useSessionStore.setState({ token: null, member: null });
    await createMemberRefresher(fetchMe, now)({ force: true });
    expect(replies).toHaveLength(0);
  });
});
