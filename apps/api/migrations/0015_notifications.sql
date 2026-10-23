-- Push notifications: the devices that receive them, each member's switches, and the notices planned for events.
-- 推送通知：接收通知的设备、每位成员的通知开关，以及为活动安排的通知。

-- One row per browser subscription or Android app install. For webpush, endpoint is the subscription URL and
-- keys_json holds {p256dh, auth}; for fcm, endpoint is the registration token and keys_json is empty.
-- A device follows whoever registered it last, and only receives pushes while that sign-in (session_id) is live,
-- so signing out elsewhere or resetting the password also stops pushes to that device.
-- 每个浏览器订阅或每次安卓应用安装一行。webpush 的 endpoint 为订阅地址，keys_json 存 {p256dh, auth}；
-- fcm 的 endpoint 为注册令牌，keys_json 为空。设备归最后一次登记它的成员所有，且只在该次登录（session_id）有效时接收推送，
-- 因此在别处退出登录或重设密码也会停止向该设备推送。
CREATE TABLE push_devices (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('webpush', 'fcm')),
  endpoint TEXT NOT NULL UNIQUE,
  keys_json TEXT,
  platform TEXT,
  session_id TEXT REFERENCES sessions (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  -- Consecutive delivery failures; the device is removed after five.
  -- 连续投递失败次数；达到五次时删除该设备。
  failure_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX push_devices_member ON push_devices (member_id);
CREATE INDEX push_devices_session ON push_devices (session_id);

-- Missing row means every switch is on.
-- 没有记录表示所有开关都开启。
CREATE TABLE notification_prefs (
  member_id TEXT PRIMARY KEY REFERENCES members (id) ON DELETE CASCADE,
  messages INTEGER NOT NULL DEFAULT 1,
  events INTEGER NOT NULL DEFAULT 1,
  preview INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

-- Notices planned for an event: when it is published, the morning of the event, and custom times.
-- The cron moves a row from pending to sending when it claims it; claimed_at and attempts let a row
-- stuck in sending go back to pending once.
-- 活动的通知计划：发布时、活动当天早上，以及自定义时间。定时任务领取一行时把它从 pending 改为 sending；
-- claimed_at 和 attempts 让卡在 sending 的行回到 pending 一次。
CREATE TABLE event_notifications (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('publish', 'morning', 'custom')),
  send_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'cancelled', 'failed')),
  sent_at TEXT,
  recipient_count INTEGER,
  claimed_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX event_notifications_due ON event_notifications (status, send_at);
CREATE INDEX event_notifications_event ON event_notifications (event_id);
