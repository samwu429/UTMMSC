-- Members and authentication
-- 成员与认证

CREATE TABLE members (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending', 'disabled')),
  role TEXT NOT NULL CHECK (role IN ('student', 'alumni', 'department_lead', 'executive', 'superadmin')),
  enrollment_status TEXT NOT NULL CHECK (enrollment_status IN ('student', 'alumni')),
  graduation_year INTEGER NOT NULL,
  major TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX members_graduation_year ON members (graduation_year);
CREATE INDEX members_enrollment_status ON members (enrollment_status);
CREATE INDEX members_display_name ON members (display_name);

CREATE TABLE email_verifications (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('register', 'reset')),
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX email_verifications_email ON email_verifications (email, purpose, created_at);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX sessions_member ON sessions (member_id);

CREATE TABLE manual_applications (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  enrollment_status TEXT NOT NULL CHECK (enrollment_status IN ('student', 'alumni')),
  graduation_year INTEGER NOT NULL,
  major TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by TEXT REFERENCES members (id),
  reviewed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX manual_applications_status ON manual_applications (status, created_at);

-- Chat structure. Message bodies live inside each ChatRoom Durable Object.
-- 聊天结构。消息正文存放在各 ChatRoom Durable Object 内部。

CREATE TABLE channels (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  audience TEXT NOT NULL CHECK (audience IN ('all', 'student', 'alumni', 'custom')),
  post_policy TEXT NOT NULL DEFAULT 'members' CHECK (post_policy IN ('members', 'staff')),
  created_by TEXT REFERENCES members (id),
  created_at TEXT NOT NULL,
  last_message_at TEXT
);

CREATE TABLE channel_memberships (
  channel_id TEXT NOT NULL REFERENCES channels (id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  joined_at TEXT NOT NULL,
  PRIMARY KEY (channel_id, member_id)
);

CREATE TABLE direct_conversations (
  id TEXT PRIMARY KEY,
  member_low TEXT NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  member_high TEXT NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  last_message_at TEXT,
  last_preview TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (member_low, member_high)
);

CREATE INDEX direct_conversations_low ON direct_conversations (member_low, last_message_at);
CREATE INDEX direct_conversations_high ON direct_conversations (member_high, last_message_at);

-- Files, events, announcements
-- 文件、活动、公告

CREATE TABLE files (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN ('governance', 'event-plans', 'departments')),
  object_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  uploaded_by TEXT NOT NULL REFERENCES members (id),
  created_at TEXT NOT NULL
);

CREATE INDEX files_category ON files (category, created_at);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  location TEXT,
  description TEXT,
  created_by TEXT NOT NULL REFERENCES members (id),
  created_at TEXT NOT NULL
);

CREATE INDEX events_starts_at ON events (starts_at);

CREATE TABLE announcements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  sent_by TEXT NOT NULL REFERENCES members (id),
  sent_at TEXT NOT NULL,
  recipient_count INTEGER NOT NULL,
  emailed INTEGER NOT NULL DEFAULT 0
);

-- Default channels every approved member can read.
-- 每位通过审核的成员都能读取的默认频道。

INSERT INTO channels (id, slug, name, description, audience, post_policy, created_at) VALUES
  ('ch_all', 'all', '全体成员', '所有在校生与毕业生', 'all', 'members', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('ch_students', 'students', '在校生', '当前在读成员', 'student', 'members', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('ch_alumni', 'alumni', '毕业生', '已毕业成员', 'alumni', 'members', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('ch_notices', 'notices', '公告', '主席团发布，仅负责人及以上可发言', 'all', 'staff', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
