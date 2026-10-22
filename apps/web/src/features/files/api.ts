import type { FileCategory, FileListResponse, FileUploadResponse } from '@utmmsc/shared';
import { api } from '../../shared/api/client';

export const filesApi = {
  list: (category: FileCategory) => api<FileListResponse>(`/files/category/${category}`),
  upload: (category: FileCategory, file: File) =>
    api<FileUploadResponse>(`/files/category/${category}`, {
      method: 'POST',
      rawBody: file,
      headers: { 'content-type': file.type || 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name) },
    }),
  download: (id: string) => api<Blob>(`/files/${encodeURIComponent(id)}/download`, { responseType: 'blob' }),
  remove: (id: string) => api<{ ok: true }>(`/files/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
