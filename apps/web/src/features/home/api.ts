import type { DailyCardResponse } from '@utmmsc/shared';
import { api } from '../../shared/api/client';

export const homeApi = {
  daily: () => api<DailyCardResponse>('/home/daily'),
};
