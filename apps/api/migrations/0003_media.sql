-- Profile photos and moment attachments
-- 头像与动态里的照片、视频

ALTER TABLE members ADD COLUMN avatar_key TEXT;

CREATE TABLE post_media (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  object_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'video')),
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX post_media_post ON post_media (post_id, sort_order);
