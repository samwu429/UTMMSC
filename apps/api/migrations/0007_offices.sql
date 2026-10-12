-- Constitution offices replace the two shared staff buckets.
-- 章程职位替换原来的两档管理层身份。

PRAGMA defer_foreign_keys = ON;

CREATE TABLE members_offices (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending', 'disabled')),
  role TEXT NOT NULL CHECK (role IN (
    'student',
    'alumni',
    'president',
    'secretary_general',
    'vp_finance',
    'vp_audit',
    'head_technology',
    'head_academic',
    'head_publicity',
    'head_sponsorship',
    'head_events',
    'superadmin'
  )),
  enrollment_status TEXT NOT NULL CHECK (enrollment_status IN ('student', 'alumni')),
  graduation_year INTEGER NOT NULL,
  major TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  headline TEXT,
  about TEXT,
  location TEXT,
  skills TEXT NOT NULL DEFAULT '[]',
  open_to TEXT NOT NULL DEFAULT '[]',
  avatar_key TEXT,
  cover_key TEXT
);

INSERT INTO members_offices (
  id, email, display_name, password_hash, status, role, enrollment_status, graduation_year, major,
  created_at, updated_at, headline, about, location, skills, open_to, avatar_key, cover_key
)
SELECT
  id, email, display_name, password_hash, status, role, enrollment_status, graduation_year, major,
  created_at, updated_at, headline, about, location, skills, open_to, avatar_key, cover_key
FROM members;

DROP TABLE members;

ALTER TABLE members_offices RENAME TO members;

CREATE INDEX members_graduation_year ON members (graduation_year);
CREATE INDEX members_enrollment_status ON members (enrollment_status);
CREATE INDEX members_display_name ON members (display_name);
