-- Profile details, experience, and member posts
-- 个人资料、经历与成员动态

ALTER TABLE members ADD COLUMN headline TEXT;
ALTER TABLE members ADD COLUMN about TEXT;
ALTER TABLE members ADD COLUMN location TEXT;
ALTER TABLE members ADD COLUMN skills TEXT NOT NULL DEFAULT '[]';
ALTER TABLE members ADD COLUMN open_to TEXT NOT NULL DEFAULT '[]';

CREATE TABLE experiences (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  organization TEXT NOT NULL,
  start_year INTEGER,
  end_year INTEGER,
  current INTEGER NOT NULL DEFAULT 0 CHECK (current IN (0, 1)),
  description TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX experiences_member ON experiences (member_id, current, start_year);

CREATE TABLE posts (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX posts_created ON posts (created_at);
CREATE INDEX posts_member ON posts (member_id, created_at);
