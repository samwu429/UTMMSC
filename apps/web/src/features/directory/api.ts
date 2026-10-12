import type { DirectoryQuery, DirectoryResponse } from '@utmmsc/shared';
import { api } from '../../shared/api/client';

export const directoryApi = {
  list: (query: DirectoryQuery) => {
    const params = new URLSearchParams();
    if (query.q) params.set('q', query.q);
    if (query.enrollmentStatus) params.set('enrollmentStatus', query.enrollmentStatus);
    if (query.graduationYear) params.set('graduationYear', String(query.graduationYear));
    if (query.cursor) params.set('cursor', query.cursor);
    const qs = params.toString();
    return api<DirectoryResponse>(`/members${qs ? `?${qs}` : ''}`);
  },
};
