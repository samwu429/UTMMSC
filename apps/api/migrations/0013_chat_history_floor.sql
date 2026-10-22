-- Channel history floor, join times for audience channels, and per-member chat list settings.
-- 频道历史下限、按受众进入频道的加入时间，以及每位成员的聊天列表设置。

-- 'since_join' follows WeChat: members who join later only see messages from their join on.
-- 'all' lets new members read the full history. The default must match DEFAULT_HISTORY_VISIBILITY.
-- 'since_join' 与微信一致：之后加入的成员只能看到加入之后的消息。
-- 'all' 允许新成员查看全部历史。默认值必须与 DEFAULT_HISTORY_VISIBILITY 一致。
ALTER TABLE channels ADD COLUMN history_visibility TEXT NOT NULL DEFAULT 'since_join' CHECK (history_visibility IN ('since_join', 'all'));

-- Members who joined before this instant keep the full history. It moves to now whenever staff switch a channel back to since_join.
-- 在此时刻之前加入的成员保留完整历史。负责人把频道切回 since_join 时，它会更新为当前时间。
ALTER TABLE channels ADD COLUMN history_floor_since TEXT;

-- Every existing channel starts the policy now, so everyone already in a channel keeps what they can see today.
-- The format matches toISOString.
-- 所有现有频道从现在开始执行该策略，已在频道里的人仍能看到今天能看到的内容。格式与 toISOString 一致。
UPDATE channels SET history_floor_since = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');

-- 1 when joined_at was written by code that keeps join times when a member list is saved. The Worker
-- that runs before this release rewrites every row with joined_at = now on each save, including saves
-- made after this migration and before the new Worker is live. Such rows keep the default 0 and count as
-- joined before the policy started, so no deploy order or admin edit in between can floor existing members.
-- 为 1 表示 joined_at 由保存成员名单时会保留加入时间的代码写入。本次发布之前的 Worker 每次保存都会以当前时间重写所有行，
-- 包括在本迁移之后、新 Worker 上线之前的保存。这些行保持默认值 0，视为在策略开始之前加入，因此无论部署顺序如何、期间是否有管理员编辑，都不会让现有成员受下限限制。
ALTER TABLE channel_memberships ADD COLUMN join_tracked INTEGER NOT NULL DEFAULT 0;

-- When an admin role or enrollment change makes a member newly eligible for an audience channel.
-- Members without a row fall back to the later of their account creation and the channel creation.
-- 管理员修改身份或在读状态、使成员新获得某个受众频道的资格时记录的时间。
-- 没有记录的成员按账号创建时间与频道创建时间中较晚的一个计算。
CREATE TABLE channel_joins (
  channel_id TEXT NOT NULL REFERENCES channels (id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  joined_at TEXT NOT NULL,
  PRIMARY KEY (channel_id, member_id)
);

CREATE INDEX channel_joins_member ON channel_joins (member_id);

-- Pin, mute, mark-as-unread and hide for one member and one room (channel or direct conversation).
-- 某成员对某个房间（频道或私聊）的置顶、免打扰、标为未读和隐藏设置。
CREATE TABLE chat_prefs (
  member_id TEXT NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  room_id TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  muted INTEGER NOT NULL DEFAULT 0,
  marked_unread INTEGER NOT NULL DEFAULT 0,
  hidden_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (member_id, room_id)
);
