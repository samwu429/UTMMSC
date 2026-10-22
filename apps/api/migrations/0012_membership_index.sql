-- Looking up which custom channels one member belongs to runs on every chat overview and ticket.
-- The primary key leads with channel_id, so this needs its own index.
-- 每次打开聊天概览和领取票据都会查某成员属于哪些自定义频道。主键以 channel_id 开头，需要单独的索引。

CREATE INDEX IF NOT EXISTS channel_memberships_member ON channel_memberships (member_id);
