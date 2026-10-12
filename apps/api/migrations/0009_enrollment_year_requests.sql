-- A member can ask to correct the enrollment year. It stays unchanged until a system admin agrees.
-- 成员可以申请更正入学年份。系统管理员同意之前，原来的年份不变。

CREATE TABLE enrollment_year_requests (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  requested_year INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  reviewer_id TEXT
);

CREATE INDEX enrollment_year_requests_pending ON enrollment_year_requests (status, created_at);
CREATE INDEX enrollment_year_requests_member ON enrollment_year_requests (member_id, status);
