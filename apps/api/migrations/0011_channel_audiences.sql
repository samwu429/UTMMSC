-- Finer channel audiences: honorary advisors, department heads, presidium, and all staff.
-- 更细的频道可见范围：荣誉顾问、部门部长、主席团，以及全体负责人。

PRAGMA defer_foreign_keys = ON;

CREATE TABLE channels_audiences (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  audience TEXT NOT NULL CHECK (audience IN (
    'all',
    'student',
    'alumni',
    'honorary',
    'heads',
    'officers',
    'staff',
    'custom'
  )),
  post_policy TEXT NOT NULL DEFAULT 'members' CHECK (post_policy IN ('members', 'staff')),
  created_by TEXT REFERENCES members (id),
  created_at TEXT NOT NULL,
  last_message_at TEXT
);

INSERT INTO channels_audiences (
  id, slug, name, description, audience, post_policy, created_by, created_at, last_message_at
)
SELECT
  id, slug, name, description, audience, post_policy, created_by, created_at, last_message_at
FROM channels;

DROP TABLE channels;
ALTER TABLE channels_audiences RENAME TO channels;
