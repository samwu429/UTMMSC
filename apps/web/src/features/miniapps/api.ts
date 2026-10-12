import { api } from '../../shared/api/client';

export const miniappApi = {
  pins: () => api<{ ids: string[] }>('/miniapps/pins'),
  pin: (id: string) => api<{ ok: true }>('/miniapps/pins', { method: 'POST', body: { id } }),
  unpin: (id: string) => api<{ ok: true }>(`/miniapps/pins/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
