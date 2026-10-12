/** Profile fields and activity posts shared by the member page and the API. */
/** 成员页与接口共用的资料字段和动态。 */

export const OPEN_TO = ['internship', 'fulltime', 'study', 'research', 'alumni', 'project'] as const;
export type OpenTo = (typeof OPEN_TO)[number];

export const OPEN_TO_LABELS: Record<OpenTo, string> = {
  internship: '实习',
  fulltime: '全职',
  study: '升学',
  research: '科研',
  alumni: '校友交流',
  project: '项目合作',
};

export const HEADLINE_MAX = 80;
export const ABOUT_MAX = 800;
export const LOCATION_MAX = 40;
export const SKILL_MAX_COUNT = 12;
export const SKILL_MAX_LENGTH = 20;
export const POST_MAX = 500;
export const EXPERIENCE_LIMIT = 8;
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
export const MOMENT_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const MOMENT_VIDEO_MAX_BYTES = 25 * 1024 * 1024;
export const MOMENT_IMAGE_LIMIT = 9;

export const MOMENT_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
export const MOMENT_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'] as const;

export interface Experience {
  id: string;
  title: string;
  organization: string;
  startYear: number | null;
  endYear: number | null;
  current: boolean;
  description: string | null;
}

export interface PostMedia {
  key: string;
  contentType: string;
  kind: 'image' | 'video';
}

export interface ActivityPost {
  id: string;
  body: string;
  createdAt: string;
  authorId: string;
  authorName: string;
  authorHeadline: string | null;
  authorAvatarKey: string | null;
  media: PostMedia[];
}
