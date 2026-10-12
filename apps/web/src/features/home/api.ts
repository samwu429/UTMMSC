import type { DailyCardResponse } from '@utmmsc/shared';
import { api } from '../../shared/api/client';

export const homeApi = {
  daily: (lang: 'zh' | 'en') => api<DailyCardResponse>(`/home/daily?lang=${lang}`),
};
