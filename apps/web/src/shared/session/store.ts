import type { MemberSelf } from '@utmmsc/shared';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SessionState {
  token: string | null;
  member: MemberSelf | null;
  mediaToken: string | null;
  setSession: (token: string, member: MemberSelf, mediaToken?: string | null) => void;
  setMember: (member: MemberSelf) => void;
  setMediaToken: (mediaToken: string) => void;
  clear: () => void;
}

/** Session persists in localStorage so the installed app reopens signed in. */
/** 会话保存在 localStorage，使安装到主屏幕后重新打开仍处于登录状态。 */
export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      token: null,
      member: null,
      mediaToken: null,
      setSession: (token, member, mediaToken = null) => set({ token, member, mediaToken }),
      setMember: (member) => set({ member }),
      setMediaToken: (mediaToken) => set({ mediaToken }),
      clear: () => set({ token: null, member: null, mediaToken: null }),
    }),
    { name: 'utmmsc.session' },
  ),
);
