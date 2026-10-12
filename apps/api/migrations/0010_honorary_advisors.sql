-- Honorary advisors are titled members, not unique offices. External advisors join by invite.
-- 荣誉顾问是带头衔的成员，不是唯一职位。校外荣誉顾问通过邀请注册。

PRAGMA defer_foreign_keys = ON;

CREATE TABLE members_honorary (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending', 'disabled')),
  role TEXT NOT NULL CHECK (role IN (
    'student',
    'alumni',
    'honorary_alumni',
    'honorary_external',
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
  cover_key TEXT,
  acting_role TEXT
);

INSERT INTO members_honorary (
  id, email, display_name, password_hash, status, role, enrollment_status, graduation_year, major,
  created_at, updated_at, headline, about, location, skills, open_to, avatar_key, cover_key, acting_role
)
SELECT
  id, email, display_name, password_hash, status, role, enrollment_status, graduation_year, major,
  created_at, updated_at, headline, about, location, skills, open_to, avatar_key, cover_key, acting_role
FROM members;

DROP TABLE members;

ALTER TABLE members_honorary RENAME TO members;

CREATE INDEX members_graduation_year ON members (graduation_year);
CREATE INDEX members_enrollment_status ON members (enrollment_status);
CREATE INDEX members_display_name ON members (display_name);

CREATE TABLE advisor_invites (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX advisor_invites_email ON advisor_invites (email, created_at);
