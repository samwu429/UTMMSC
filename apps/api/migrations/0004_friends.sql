-- Friend requests. Private chat requires an accepted request in either direction.
-- 好友申请。私聊需要任一方向已通过的申请。

CREATE TABLE friend_requests (
  id TEXT PRIMARY KEY,
  from_id TEXT NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  to_id TEXT NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (from_id, to_id)
);

CREATE INDEX friend_requests_to ON friend_requests (to_id, status);
CREATE INDEX friend_requests_from ON friend_requests (from_id, status);
