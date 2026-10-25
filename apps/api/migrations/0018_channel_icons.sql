-- Channel icon: an R2 key under channel-icon/ (the 256px image; the 96px thumbnail sits beside it with a -96 suffix),
-- or preset:<id> for a bundled preset. NULL keeps the text avatar.
-- 频道图标：channel-icon/ 下的 R2 键（256px 图片；96px 缩略图在同目录，带 -96 后缀），或内置预设 preset:<id>。为 NULL 时显示文字头像。
ALTER TABLE channels ADD COLUMN icon_key TEXT CHECK (icon_key IS NULL OR icon_key LIKE 'channel-icon/%' OR icon_key LIKE 'preset:%');

-- When the icon last changed, in toISOString format. Shown to admins and used to detect concurrent edits.
-- 图标最后修改的时间，格式与 toISOString 一致。显示给管理员，并用于发现同时进行的修改。
ALTER TABLE channels ADD COLUMN icon_updated_at TEXT;
