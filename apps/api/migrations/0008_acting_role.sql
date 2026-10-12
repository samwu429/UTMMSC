-- Lets the system admin try another office without giving that office up.
-- 系统管理员可以临时换成别的身份做测试，真实身份仍是系统管理员。

ALTER TABLE members ADD COLUMN acting_role TEXT;
