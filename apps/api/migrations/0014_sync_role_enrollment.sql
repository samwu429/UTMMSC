-- Repairs members whose role and enrollment status disagree. Before the fix, changing a role to 在校生, 毕业生
-- or an honorary advisor left enrollment_status as it was, and audience channels follow enrollment_status.
-- 修复身份与在读状态不一致的成员。修复之前，把身份改为在校生、毕业生或荣誉顾问时不会同时修改 enrollment_status，而受众频道按 enrollment_status 判断。

-- Toronto's calendar year, as enrollmentCalendarYear computes it. New Year in Toronto always falls in standard
-- time (UTC-5), so the UTC year five hours earlier is the Toronto year at every instant.
-- 多伦多的日历年，与 enrollmentCalendarYear 的计算一致。多伦多的新年总在标准时间（UTC-5）内，所以五小时之前的 UTC 年份在任何时刻都等于多伦多的年份。

-- A 在校生 recorded as alumni whose enrollment is already five years old can only be a graduate.
-- 被记为毕业生的在校生，如果入学已满五年，只能是毕业生。
UPDATE members
SET role = 'alumni',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE role = 'student'
  AND enrollment_status = 'alumni'
  AND graduation_year <= CAST(strftime('%Y', 'now', '-5 hours') AS INTEGER) - 5;

-- Any other 在校生 recorded as alumni was set back to 在校生 by an admin, so the status follows the role.
-- 其余被记为毕业生的在校生是管理员改回在校生的，在读状态随身份改正。
UPDATE members
SET enrollment_status = 'student',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE role = 'student'
  AND enrollment_status = 'alumni';

-- 毕业生 and both honorary advisor roles are always alumni.
-- 毕业生和两种荣誉顾问始终是毕业生。
UPDATE members
SET enrollment_status = 'alumni',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE role IN ('alumni', 'honorary_alumni', 'honorary_external')
  AND enrollment_status <> 'alumni';
