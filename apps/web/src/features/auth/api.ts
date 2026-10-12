import type {
  ChangePasswordBody,
  LoginBody,
  ManualApplicationBody,
  MemberSelf,
  RegisterBody,
  RequestCodeBody,
  ResetPasswordBody,
  SessionResponse,
} from '@utmmsc/shared';
import { api } from '../../shared/api/client';

export const authApi = {
  requestCode: (body: RequestCodeBody) => api<{ ok: true }>('/auth/code', { method: 'POST', body, auth: false }),
  register: (body: RegisterBody) => api<SessionResponse>('/auth/register', { method: 'POST', body, auth: false }),
  login: (body: LoginBody) => api<SessionResponse>('/auth/login', { method: 'POST', body, auth: false }),
  reset: (body: ResetPasswordBody) => api<SessionResponse>('/auth/reset', { method: 'POST', body, auth: false }),
  apply: (body: ManualApplicationBody) => api<{ ok: true }>('/auth/apply', { method: 'POST', body, auth: false }),
  me: () => api<{ member: MemberSelf; mediaToken: string }>('/auth/me'),
  invite: (token: string) => api<{ email: string }>(`/auth/invite?token=${encodeURIComponent(token)}`, { auth: false }),
  logout: () => api<{ ok: true }>('/auth/logout', { method: 'POST' }),
  changePassword: (body: ChangePasswordBody) => api<{ ok: true }>('/auth/password', { method: 'POST', body }),
};
