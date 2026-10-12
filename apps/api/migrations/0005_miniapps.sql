-- Personal pins for technology-department mini apps. The catalog itself lives in code.
-- 技术部小程序的个人收藏。目录本身写在代码里。

CREATE TABLE miniapp_pins (
  member_id TEXT NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  app_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (member_id, app_id)
);
