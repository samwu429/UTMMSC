import type { MemberSelf } from '@utmmsc/shared';
import { useSessionStore } from '../../shared/session/store';
import { authApi } from './api';

/** Coming back to the app refetches the member at most this often. */
/** 回到应用时，最多每隔这么久重新获取一次成员资料。 */
export const MEMBER_REFRESH_GAP_MS = 60_000;

interface Inflight {
  token: string;
  promise: Promise<void>;
  /** A forced refresh asked for while this one runs; it may have been answered before the change it is for. */
  /** 本次请求进行期间要求的强制刷新；本次的回复可能早于它所针对的变更。 */
  again: Promise<void> | null;
}

/**
 * Reloads the signed-in member and media token from /auth/me, so screens gated on role or enrollment follow
 * changes someone else made. Unforced calls wait at least a minute between fetches and share one in flight.
 * Tests pass a fake fetch and clock.
 * 从 /auth/me 重新加载登录成员与媒体令牌，按身份或在读状态显示的页面因此能跟上别人做的修改。非强制调用两次获取之间至少间隔一分钟，
 * 并共用进行中的请求。测试时传入替身的请求和时钟。
 */
export function createMemberRefresher(fetchMe: () => Promise<{ member: MemberSelf; mediaToken: string }>, now: () => number = Date.now) {
  let lastStartedAt: number | null = null;
  let inflight: Inflight | null = null;

  function refresh(options: { force?: boolean } = {}): Promise<void> {
    const token = useSessionStore.getState().token;
    if (!token) return Promise.resolve();
    const running = inflight?.token === token ? inflight : null;
    if (running) {
      if (!options.force) return running.promise;
      running.again ??= running.promise.then(() => refresh({ force: true }));
      return running.again;
    }
    const at = now();
    if (!options.force && lastStartedAt !== null && at - lastStartedAt < MEMBER_REFRESH_GAP_MS) return Promise.resolve();
    lastStartedAt = at;
    const entry: Inflight = { token, promise: Promise.resolve(), again: null };
    entry.promise = fetchMe()
      .then((res) => {
        // A reply for a session that has since ended or changed must not overwrite the current one.
        // 已结束或已更换的会话的回复不能覆盖当前会话。
        const session = useSessionStore.getState();
        if (session.token !== token) return;
        session.setMember(res.member);
        session.setMediaToken(res.mediaToken);
      })
      .catch(() => undefined)
      .finally(() => {
        if (inflight === entry) inflight = null;
      });
    inflight = entry;
    return entry.promise;
  }

  return refresh;
}

export const refreshMember = createMemberRefresher(() => authApi.me());
