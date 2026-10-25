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

/**
 * Whether two JSON values (the member as the server sends it) hold the same data. Key order does not matter.
 * 两个 JSON 值（服务端发来的成员资料）是否内容相同。键的顺序无关。
 */
export function sameJson(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, i) => sameJson(item, b[i]));
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && sameJson(left[key], right[key]));
}

/**
 * Session persists in localStorage so the installed app reopens signed in. The member is refreshed on every return to
 * the app; an unchanged reply keeps the current object, so nothing that reads the member re-renders for it.
 * 会话保存在 localStorage，使安装到主屏幕后重新打开仍处于登录状态。每次回到应用都会刷新成员资料；内容不变时保留当前对象，
 * 读取成员资料的组件因此不会为此重新渲染。
 */
export const useSessionStore = create<SessionState>()(
  persist(
    (set, get) => ({
      token: null,
      member: null,
      mediaToken: null,
      setSession: (token, member, mediaToken = null) => set({ token, member, mediaToken }),
      setMember: (member) => {
        if (!sameJson(get().member, member)) set({ member });
      },
      setMediaToken: (mediaToken) => {
        if (get().mediaToken !== mediaToken) set({ mediaToken });
      },
      clear: () => set({ token: null, member: null, mediaToken: null }),
    }),
    { name: 'utmmsc.session' },
  ),
);
