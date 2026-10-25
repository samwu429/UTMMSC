-- Personal timetable (自定义课表): terms, courses with weekly meetings, days or single classes with no class,
-- assignments, each member's timetable settings, and the reminder ledger. Every row belongs to one member and only
-- that member reads it; nothing here is shown to admins or other members.
-- 个人课表：学期、按周上课的课程、停课日或单次停课、作业、每位成员的课表设置，以及提醒记录。每一行都属于一位成员，
-- 也只有该成员能读取；这里的内容不会显示给管理员或其他成员。

-- One row per member who has saved anything; a missing row means the defaults. rev goes up with every timetable
-- write, so GET /home/timetable?rev= can answer "unchanged" after reading this one row.
-- class_reminders is off until the member turns it on. assignment_offsets is the default for new assignments only.
-- locale is the language of this member's timetable pushes, sent by the app.
-- 每位保存过内容的成员一行；没有记录表示使用默认值。每次写入课表 rev 加一，GET /home/timetable?rev= 因此只读这一行就能回答「没有变化」。
-- class_reminders 在成员开启前为关闭。assignment_offsets 只作为新作业的默认提醒。locale 是该成员课表推送使用的语言，由 App 发送。
CREATE TABLE timetable_settings (
  member_id TEXT PRIMARY KEY REFERENCES members (id) ON DELETE CASCADE,
  rev INTEGER NOT NULL DEFAULT 0,
  class_reminders INTEGER NOT NULL DEFAULT 0 CHECK (class_reminders IN (0, 1)),
  class_lead_min INTEGER NOT NULL DEFAULT 10 CHECK (class_lead_min IN (5, 10, 15, 20, 30)),
  assignment_offsets TEXT NOT NULL DEFAULT '["1d","1h"]' CHECK (json_valid(assignment_offsets) AND json_type(assignment_offsets) = 'array'),
  show_weekend TEXT NOT NULL DEFAULT 'always' CHECK (show_weekend IN ('always', 'auto')),
  locale TEXT NOT NULL DEFAULT 'zh' CHECK (locale IN ('zh', 'en')),
  updated_at TEXT NOT NULL
);

-- The client chooses every id below (prefix and 22 random base64url characters), so a save sent twice or replayed
-- from the offline queue writes one row. starts_on and ends_on are Toronto dates (YYYY-MM-DD). Week 1 is the
-- Monday-to-Sunday week holding starts_on. skip_weeks lists weeks with no classes, such as reading week.
-- 以下所有 id 都由客户端生成（前缀加 22 个随机 base64url 字符），重复发送或从离线队列重放的保存只写入一行。
-- starts_on 与 ends_on 是多伦多日期（YYYY-MM-DD）。第 1 周是包含 starts_on 的周一到周日。skip_weeks 列出不上课的周，例如阅读周。
CREATE TABLE timetable_terms (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL,
  skip_weeks TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(skip_weeks) AND json_type(skip_weeks) = 'array'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (starts_on <= ends_on)
);
CREATE INDEX timetable_terms_member ON timetable_terms (member_id);

-- term_id NULL: the course repeats every week with no end. Deleting a term deletes its courses; the app says how
-- many first. remind is the per-course switch for class reminders.
-- term_id 为 NULL：课程每周重复，没有结束日期。删除学期会删除其中的课程，App 会先说明数量。remind 是这门课的上课提醒开关。
CREATE TABLE timetable_courses (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  term_id TEXT REFERENCES timetable_terms (id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  title TEXT,
  color TEXT NOT NULL,
  notes TEXT,
  remind INTEGER NOT NULL DEFAULT 1 CHECK (remind IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX timetable_courses_member ON timetable_courses (member_id);
CREATE INDEX timetable_courses_term ON timetable_courses (term_id);

-- Toronto wall-clock time, never UTC: weekday 1 (Monday) to 7 (Sunday), minutes after midnight on 5-minute steps.
-- The 09:00-21:00 window is enforced by the shared rules, so widening it later needs no table rebuild.
-- week_rule all/odd/even/list; list reads week_list (term weeks); every rule but all needs the course to have a term.
-- Saving a course updates meetings by id, so reminders already sent and single skipped classes survive edits.
-- 多伦多本地时间，从不存 UTC：weekday 为 1（周一）到 7（周日），分钟数从午夜起算并按 5 分钟取整。09:00-21:00 的范围由共享规则保证，
-- 以后放宽无需重建表。week_rule 为 all/odd/even/list；list 读取 week_list（学期周次）；除 all 以外都要求课程属于某个学期。
-- 保存课程时按 id 更新上课时间，因此已发出的提醒记录和单次停课在修改后仍然有效。
CREATE TABLE timetable_meetings (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES timetable_courses (id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'lec' CHECK (kind IN ('lec', 'tut', 'pra', 'lab', 'sem', 'other')),
  section TEXT,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  start_min INTEGER NOT NULL CHECK (start_min BETWEEN 0 AND 1435 AND start_min % 5 = 0),
  end_min INTEGER NOT NULL CHECK (end_min BETWEEN 5 AND 1440 AND end_min % 5 = 0),
  location TEXT,
  week_rule TEXT NOT NULL DEFAULT 'all' CHECK (week_rule IN ('all', 'odd', 'even', 'list')),
  week_list TEXT CHECK (week_list IS NULL OR (json_valid(week_list) AND json_type(week_list) = 'array')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (end_min > start_min),
  CHECK ((week_rule = 'list') = (week_list IS NOT NULL))
);
CREATE INDEX timetable_meetings_slot ON timetable_meetings (weekday, start_min);
CREATE INDEX timetable_meetings_course ON timetable_meetings (course_id);
CREATE INDEX timetable_meetings_member ON timetable_meetings (member_id);

-- A Toronto date with no class: meeting_id NULL for every class that day (a holiday), or one meeting (本次不上).
-- 没有课的多伦多日期：meeting_id 为 NULL 表示当天所有课都不上（假日），否则只停这一次课（本次不上）。
CREATE TABLE timetable_skips (
  member_id TEXT NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  on_date TEXT NOT NULL,
  meeting_id TEXT REFERENCES timetable_meetings (id) ON DELETE CASCADE,
  label TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX timetable_skips_key ON timetable_skips (member_id, on_date, IFNULL(meeting_id, ''));
CREATE INDEX timetable_skips_meeting ON timetable_skips (meeting_id);

-- due_at is a UTC instant on a whole minute, at any time of day (deadlines are often 23:59). remind_offsets holds
-- up to three of 30m, 1h, 3h, morning, 1d, 2d, 1w; it is copied from the settings when the assignment is created.
-- done_at is set when the member ticks it off.
-- due_at 为整分钟的 UTC 时间，可以是一天中的任意时间（截止时间常为 23:59）。remind_offsets 最多包含 30m、1h、3h、morning、1d、2d、1w
-- 中的三个，新建作业时从设置复制。done_at 在成员勾选完成时填写。
CREATE TABLE timetable_assignments (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  course_id TEXT REFERENCES timetable_courses (id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  notes TEXT,
  due_at TEXT NOT NULL,
  remind_offsets TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(remind_offsets) AND json_type(remind_offsets) = 'array'),
  done_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX timetable_assignments_member ON timetable_assignments (member_id, due_at);
CREATE INDEX timetable_assignments_course ON timetable_assignments (course_id);

-- Reminder ledger. A class row is written by the minute cron when it claims an occurrence (meeting, start instant),
-- so one class is reminded once whatever the lead time, and a class whose time changed is reminded again. An
-- assignment row is planned when the assignment is saved, one per offset and due time. The cron never sends a row
-- after expires_at (the class start or the due time). offset_key: the lead such as 10m for a class, the offset for
-- an assignment.
-- 提醒记录。上课提醒由每分钟的定时任务在领取一次课（上课时间 id 与开始时刻）时写入，因此同一次课无论提前多久只提醒一次，改了时间的课会再提醒。
-- 作业提醒在保存作业时按每个提醒时间和截止时间安排。定时任务在 expires_at（上课开始或截止时间）之后不再发送。
-- offset_key：上课提醒为提前时间（如 10m），作业提醒为提醒时间。
CREATE TABLE timetable_reminders (
  id INTEGER PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('class', 'assignment')),
  meeting_id TEXT REFERENCES timetable_meetings (id) ON DELETE CASCADE,
  assignment_id TEXT REFERENCES timetable_assignments (id) ON DELETE CASCADE,
  occurs_at TEXT NOT NULL,
  offset_key TEXT NOT NULL,
  send_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'skipped', 'cancelled', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  claimed_at TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL,
  CHECK ((kind = 'class') = (meeting_id IS NOT NULL) AND (kind = 'assignment') = (assignment_id IS NOT NULL))
);
CREATE UNIQUE INDEX timetable_reminders_class ON timetable_reminders (meeting_id, occurs_at) WHERE meeting_id IS NOT NULL;
CREATE UNIQUE INDEX timetable_reminders_assignment ON timetable_reminders (assignment_id, occurs_at, offset_key) WHERE assignment_id IS NOT NULL;
CREATE INDEX timetable_reminders_due ON timetable_reminders (status, send_at);

-- 课表提醒 in Settings -> Notifications, over class and assignment reminders. A missing row still means on.
-- 设置 → 通知中的「课表提醒」，统管上课提醒和作业提醒。没有记录仍表示开启。
ALTER TABLE notification_prefs ADD COLUMN timetable INTEGER NOT NULL DEFAULT 1;
