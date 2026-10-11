import type { MemberSelf } from '@utmmsc/shared';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SessionState {
  token: string | null;
  member: MemberSelf | null;
  setSession: (token: string, member: MemberSelf) => void;
  setMember: (member: MemberSelf) => void;
  clear: () => void;
}

/** Session persists in localStorage so the installed app reopens signed in. */
/** 会话保存在 localStorage，使安装到主屏幕后重新打开仍处于登录状态。 */
export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      token: null,
      member: null,
      setSession: (token, member) => set({ token, member }),
      setMember: (member) => set({ member }),
      clear: () => set({ token: null, member: null }),
    }),
    { name: 'utmmsc.session' },
  ),
);
