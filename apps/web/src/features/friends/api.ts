import type { FriendSummary, FriendshipState } from '@utmmsc/shared';
import { api } from '../../shared/api/client';

export const friendsApi = {
  summary: () => api<FriendSummary>('/friends'),
  request: (memberId: string) => api<{ friendship: FriendshipState }>('/friends', { method: 'POST', body: { memberId } }),
  accept: (memberId: string) => api<{ friendship: FriendshipState }>(`/friends/${encodeURIComponent(memberId)}/accept`, { method: 'POST' }),
  reject: (memberId: string) => api<{ friendship: FriendshipState }>(`/friends/${encodeURIComponent(memberId)}/reject`, { method: 'POST' }),
};
