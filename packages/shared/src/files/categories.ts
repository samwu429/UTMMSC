/**
 * Fixed file library categories. Each maps to an R2 key prefix so storage layout mirrors the UI.
 * 文件库固定分类。每个分类对应一个 R2 键前缀，使存储结构与界面一致。
 */
export const FILE_CATEGORIES = ['governance', 'event-plans', 'departments'] as const;
export type FileCategory = (typeof FILE_CATEGORIES)[number];

export const FILE_CATEGORY_LABELS: Record<FileCategory, string> = {
  governance: '社团管理',
  'event-plans': '活动策划',
  departments: '部门资料',
};

export const FILE_MAX_BYTES = 25 * 1024 * 1024;
export const CHAT_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

export const CHAT_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;

export function isFileCategory(value: string): value is FileCategory {
  return (FILE_CATEGORIES as readonly string[]).includes(value);
}

export interface FileRecord {
  id: string;
  category: FileCategory;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy: { id: string; displayName: string };
  createdAt: string;
}
