-- Friend updates rebuilt after WeChat Moments: who may see a post, where it was posted, sized media with a
-- preview, likes, comments, interaction notices, how far each member has read, per-person hide and mute,
-- reports and moderator actions, uploads waiting for a post, and the switch for moments pushes.
-- 仿照微信朋友圈重做好友动态：动态的可见范围与位置、带尺寸和预览图的媒体、点赞、评论、互动消息、每位成员读到哪里、
-- 按人设置的「不让TA看」与「不看TA」、投诉与管理操作、尚未发表的上传，以及动态推送开关。

-- friends: the author's accepted friends. club: every active member. private: the author alone.
-- Posts written before this migration were shown to the whole club, so they keep that audience.
-- friends：作者已通过的好友。club：全体在用成员。private：仅作者本人。本迁移之前的动态原本对全社团可见，因此保持不变。
ALTER TABLE posts ADD COLUMN audience TEXT NOT NULL DEFAULT 'club' CHECK (audience IN ('friends', 'club', 'private'));
ALTER TABLE posts ADD COLUMN location TEXT;
-- Chosen by the composer; publishing again with the same id returns the first post instead of a copy.
-- 由编辑器生成；用同一 id 再次发表时返回第一次的动态，而不是再发一条。
ALTER TABLE posts ADD COLUMN client_id TEXT;
-- Set when a moderator removes the post. Only its author still sees it, marked as removed.
-- 管理员移除动态时填写。之后只有作者还能看到，并标明已被移除。
ALTER TABLE posts ADD COLUMN removed_at TEXT;
ALTER TABLE posts ADD COLUMN removed_by TEXT REFERENCES members (id) ON DELETE SET NULL;
ALTER TABLE posts ADD COLUMN removed_reason TEXT;

CREATE UNIQUE INDEX posts_client ON posts (member_id, client_id) WHERE client_id IS NOT NULL;
-- Keyset paging walks (created_at, id) newest first; it covers what the single-column index did.
-- 键集分页按 (created_at, id) 从新到旧遍历；它涵盖了原来单列索引的用途。
CREATE INDEX posts_page ON posts (created_at, id);
DROP INDEX IF EXISTS posts_created;

-- Pixel size as decoded with EXIF orientation applied, so the feed reserves the right box before loading.
-- preview_key is a JPEG at most 720px on the long edge: a scaled copy of a photo, or a video's first frame.
-- 按 EXIF 方向解码后的像素尺寸，信息流在加载前就能预留正确的大小。
-- preview_key 是长边不超过 720px 的 JPEG：照片的缩小版，或视频的第一帧。
ALTER TABLE post_media ADD COLUMN width INTEGER;
ALTER TABLE post_media ADD COLUMN height INTEGER;
ALTER TABLE post_media ADD COLUMN duration_ms INTEGER;
ALTER TABLE post_media ADD COLUMN preview_key TEXT;
CREATE INDEX post_media_object ON post_media (object_key);
CREATE INDEX post_media_preview ON post_media (preview_key) WHERE preview_key IS NOT NULL;

CREATE TABLE post_likes (
  post_id TEXT NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (post_id, member_id)
);

CREATE INDEX post_likes_member ON post_likes (member_id, created_at);

-- reply_to_member_id stays when the answered comment is deleted, so "A 回复 B" still reads right.
-- A moderator's removal sets removed_at; a delete by the comment's author or the post's author removes the row.
-- 被回复的评论删除后仍保留 reply_to_member_id，「A 回复 B」依然成立。
-- 管理员移除时填写 removed_at；评论作者或动态作者删除时直接删掉这一行。
CREATE TABLE post_comments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  reply_to_comment_id TEXT REFERENCES post_comments (id) ON DELETE SET NULL,
  reply_to_member_id TEXT REFERENCES members (id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  client_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  removed_at TEXT,
  removed_by TEXT REFERENCES members (id) ON DELETE SET NULL,
  removed_reason TEXT,
  UNIQUE (author_id, client_id)
);

CREATE INDEX post_comments_post ON post_comments (post_id, created_at, id);
CREATE INDEX post_comments_author ON post_comments (author_id, created_at);

-- One row per thing a member should hear about. like: liked your post (one row per liker and post; unliking
-- deletes it). comment: commented on your post. reply: answered you. thread: someone you can see commented on a
-- post you liked or commented on (in-app only). removed: a moderator removed your post or comment (no actor).
-- 每条需要告知成员的互动一行。like：赞了你的动态（每位点赞者每条动态一行，取消赞即删除）。comment：评论了你的动态。
-- reply：回复了你。thread：你能看到的人评论了你赞过或评论过的动态（只在应用内显示）。removed：管理员移除了你的动态或评论（没有操作者）。
CREATE TABLE moment_notices (
  id TEXT PRIMARY KEY,
  recipient_id TEXT NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  actor_id TEXT REFERENCES members (id) ON DELETE CASCADE,
  post_id TEXT NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  comment_id TEXT REFERENCES post_comments (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('like', 'comment', 'reply', 'thread', 'removed')),
  created_at TEXT NOT NULL,
  read_at TEXT
);

CREATE UNIQUE INDEX moment_notices_like ON moment_notices (recipient_id, actor_id, post_id) WHERE kind = 'like';
CREATE UNIQUE INDEX moment_notices_comment ON moment_notices (recipient_id, comment_id) WHERE comment_id IS NOT NULL AND kind <> 'removed';
CREATE INDEX moment_notices_inbox ON moment_notices (recipient_id, created_at, id);
CREATE INDEX moment_notices_unread ON moment_notices (recipient_id, created_at) WHERE read_at IS NULL;
CREATE INDEX moment_notices_post ON moment_notices (post_id, recipient_id, created_at);
-- Child keys of the comment foreign keys, so deleting a comment (alone or with its post) finds its notices and the replies to it without scanning either table.
-- 评论外键的子键：删除评论（单独删除或随动态删除）时，无需扫描两张表即可找到它的消息和对它的回复。
CREATE INDEX moment_notices_comment_ref ON moment_notices (comment_id);
CREATE INDEX post_comments_reply ON post_comments (reply_to_comment_id);

-- The newest post time a member has seen on the home feed, for the dot on 发现. No row: no dot until the first visit.
-- 成员在动态首页看到的最新动态时间，用于「发现」上的红点。没有记录：首次打开前不显示红点。
CREATE TABLE moment_reads (
  member_id TEXT PRIMARY KEY REFERENCES members (id) ON DELETE CASCADE,
  feed_seen_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- hide_from: member_id's updates are hidden from target_id (不让TA看). mute: member_id's home feed skips target_id (不看TA).
-- hide_from：member_id 的动态不给 target_id 看（不让TA看）。mute：member_id 的动态首页不显示 target_id（不看TA）。
CREATE TABLE moment_blocks (
  member_id TEXT NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('hide_from', 'mute')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (member_id, target_id, kind),
  CHECK (member_id <> target_id)
);

CREATE INDEX moment_blocks_target ON moment_blocks (target_id, kind);

-- Reports outlive the content on purpose (no foreign keys to it) and keep a snapshot for moderators.
-- 投诉有意比内容存在得更久（不引用内容的外键），并保留快照供管理员查看。
CREATE TABLE moment_reports (
  id TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  post_id TEXT NOT NULL,
  comment_id TEXT,
  target_member_id TEXT NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (reason IN ('spam', 'harassment', 'inappropriate', 'privacy', 'other')),
  note TEXT,
  snapshot_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'removed', 'dismissed')),
  resolved_by TEXT REFERENCES members (id) ON DELETE SET NULL,
  resolved_at TEXT,
  created_at TEXT NOT NULL
);

-- NULLs are distinct in UNIQUE, so a report on the post itself is keyed by an empty comment id.
-- UNIQUE 中 NULL 互不相等，因此只投诉动态本身时以空的评论 id 作为键。
CREATE UNIQUE INDEX moment_reports_once ON moment_reports (reporter_id, post_id, COALESCE(comment_id, ''));
CREATE INDEX moment_reports_queue ON moment_reports (status, created_at);
CREATE INDEX moment_reports_reporter ON moment_reports (reporter_id, created_at);

-- Every moderator removal, restore and dismissal, kept after the content is gone.
-- 每一次管理员移除、恢复和驳回，内容删除后仍保留。
CREATE TABLE moment_actions (
  id TEXT PRIMARY KEY,
  actor_id TEXT REFERENCES members (id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('remove_post', 'restore_post', 'remove_comment', 'restore_comment', 'dismiss_report')),
  post_id TEXT NOT NULL,
  comment_id TEXT,
  target_member_id TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX moment_actions_created ON moment_actions (created_at);

-- Files uploaded for a post that is not published yet. A publish may use a file only while its row is here.
-- The cron deletes rows older than a day, and their objects when no post uses them.
-- 为尚未发表的动态上传的文件。只有记录仍在时，发表才能使用这个文件。定时任务删除超过一天的记录，以及没有动态使用的对应对象。
CREATE TABLE moment_uploads (
  object_key TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);

CREATE INDEX moment_uploads_created ON moment_uploads (created_at);

-- Pushes for comments, replies and moderator removals. A missing row still means on.
-- 评论、回复和管理员移除的推送开关。没有记录仍表示开启。
ALTER TABLE notification_prefs ADD COLUMN moments INTEGER NOT NULL DEFAULT 1;
