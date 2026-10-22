import { Hono } from 'hono';
import { ENROLLMENT_STATUSES, MEMBER_STATUSES, ROLES, canAssignRole, isHonoraryRole, isOfficeRole, isUniversityEmail, isValidAdminEnrollmentYear, isValidEnrollmentYear, isWellFormedEmail, normalizeEmail, roleTier, shouldGraduate, type AdminMemberRow, type AnnouncementResponse, type EnrollmentStatus, type MemberStatus, type Role } from '@utmmsc/shared';
import { recordAnnouncement } from '../../../infrastructure/d1/announcements';
import { recordEligibilityChange } from '../../../infrastructure/d1/channel-joins';
import { listChannels } from '../../../infrastructure/d1/channels';
import { findApplication, listPendingApplications, reviewApplication, toApplication } from '../../../infrastructure/d1/applications';
import { createEvent, deleteEvent, listAllEvents, toEvent } from '../../../infrastructure/d1/events';
import {
  findMemberById,
  findMemberByEmail,
  listActiveMemberEmails,
  listAllMembersForAdmin,
  toProfile,
  toSelf,
  updateMemberRole,
  updateMemberStatus,
  updateActingRole,
  officeHolderExists,
  correctEnrollment,
  viewedRole,
  type MemberRow,
} from '../../../infrastructure/d1/members';
import { revokeAllSessions } from '../../../infrastructure/d1/sessions';
import { sendMail } from '../../../infrastructure/email/brevo';
import { announcementMail, applicationApprovedMail, applicationRejectedMail, advisorInviteMail, enrollmentYearDecisionMail } from '../../../infrastructure/email/templates';
import { findYearRequest, listPendingYearRequests, reviewYearRequest } from '../../../infrastructure/d1/enrollment-requests';
import { consumeAdvisorInvite, issueAdvisorInvite, listOpenInvites, retireOtherInvites } from '../../../infrastructure/d1/advisor-invites';
import { rateLimit } from '../../middleware/rate-limit';
import { revokeMemberEverywhere } from '../../rooms';
import type { AppEnv } from '../../context';
import type { Env } from '../../../env';
import { badRequest, forbidden, notFound } from '../../errors';
import { requirePermission, requireSession } from '../../middleware/session';
import { optionalString, readJson, requireInteger, requireOneOf, requireString } from '../../validation';

export const adminRoutes = new Hono<AppEnv>();

adminRoutes.use('*', requireSession);

adminRoutes.post('/acting-role', async (c) => {
  const actor = c.get('member');
  if (actor.role !== 'superadmin') throw forbidden('只有系统管理员可以切换测试身份');
  const body = await readJson<Record<string, unknown>>(c);
  const raw = body.role;
  const acting = raw === null || raw === 'superadmin' ? null : requireOneOf<Role>(raw, ROLES, '身份');
  await updateActingRole(c.env.DB, actor.id, acting);
  c.executionCtx.waitUntil(revokeMemberEverywhere(c.env, actor.id));
  const updated = await findMemberById(c.env.DB, actor.id);
  if (!updated) throw notFound('成员不存在');
  return c.json({ member: toSelf(updated) });
});

/**
 * Gives a member a real join time for every audience channel they can newly read after a role or
 * enrollment change, and drops it for channels they can no longer read. Runs before their sockets are
 * revoked, so the re-issued ticket already sees the new join time.
 * 身份或在读状态变化后，为成员新能阅读的每个受众频道记录真实的加入时间，并删除其不再能阅读的频道记录。在关闭其连接之前执行，重新签发的票据就能用上新的加入时间。
 */
async function recordJoinChanges(env: Env, before: MemberRow): Promise<void> {
  const after = await findMemberById(env.DB, before.id);
  if (!after) return;
  await recordEligibilityChange(
    env.DB,
    before.id,
    { role: viewedRole(before), enrollmentStatus: before.enrollment_status },
    { role: viewedRole(after), enrollmentStatus: after.enrollment_status },
    await listChannels(env.DB),
  );
}

function mailConfig(env: AppEnv['Bindings']) {
  return { apiKey: env.BREVO_API_KEY, fromEmail: env.MAIL_FROM_EMAIL, fromName: env.MAIL_FROM_NAME };
}

/* Manual applications */

adminRoutes.get('/applications', requirePermission('members.approve'), async (c) => {
  const rows = await listPendingApplications(c.env.DB);
  return c.json({ applications: rows.map(toApplication) });
});

adminRoutes.post('/applications/:id/:decision', requirePermission('members.approve'), async (c) => {
  const decision = requireOneOf(c.req.param('decision'), ['approve', 'reject'] as const, '决定');
  const application = await findApplication(c.env.DB, c.req.param('id'));
  if (!application || application.status !== 'pending') throw notFound('申请不存在或已处理');
  const status = decision === 'approve' ? 'approved' : 'rejected';
  if (!(await reviewApplication(c.env.DB, application.id, status, c.get('member').id))) throw notFound('申请不存在或已处理');
  const mail =
    status === 'approved'
      ? applicationApprovedMail(application.email, application.display_name, c.env.APP_BASE_URL)
      : applicationRejectedMail(application.email, application.display_name);
  c.executionCtx.waitUntil(sendMail(mailConfig(c.env), mail));
  return c.json({ ok: true, status });
});

/* Members */

adminRoutes.get('/members', requirePermission('members.assign_role'), async (c) => {
  const rows = await listAllMembersForAdmin(c.env.DB);
  const members: AdminMemberRow[] = rows.map((r) => ({ ...toProfile(r), email: r.email, status: r.status, createdAt: r.created_at }));
  return c.json({ members });
});

adminRoutes.post('/members/:id/role', requirePermission('members.assign_role'), async (c) => {
  const actor = c.get('member');
  const target = await findMemberById(c.env.DB, c.req.param('id'));
  if (!target) throw notFound('成员不存在');
  const body = await readJson<Record<string, unknown>>(c);
  const role = requireOneOf<Role>(body.role, ROLES, '身份');
  if (target.id === actor.id) throw badRequest('self_role', '不能修改自己的身份');
  if ((isHonoraryRole(target.role) || isHonoraryRole(role)) && actor.role !== 'superadmin') throw forbidden('只有系统管理员可以指定荣誉顾问');
  if (!canAssignRole(actor.role, role)) throw forbidden('无权分配该身份');
  if (roleTier(target.role) >= roleTier(actor.role) && actor.role !== 'superadmin') throw forbidden('无权修改该成员');
  if (isOfficeRole(role) && (await officeHolderExists(c.env.DB, role, target.id))) throw badRequest('office_taken', '这个职位已经有人担任');
  await updateMemberRole(c.env.DB, target.id, role);
  await recordJoinChanges(c.env, target);
  c.executionCtx.waitUntil(revokeMemberEverywhere(c.env, target.id));
  return c.json({ ok: true });
});

adminRoutes.post('/members/:id/status', requirePermission('members.assign_role'), async (c) => {
  const actor = c.get('member');
  const target = await findMemberById(c.env.DB, c.req.param('id'));
  if (!target) throw notFound('成员不存在');
  if (target.id === actor.id) throw badRequest('self_status', '不能停用自己');
  if (isHonoraryRole(target.role) && actor.role !== 'superadmin') throw forbidden('只有系统管理员可以修改荣誉顾问');
  if (roleTier(target.role) >= roleTier(actor.role) && actor.role !== 'superadmin') throw forbidden('无权修改该成员');
  const body = await readJson<Record<string, unknown>>(c);
  const status = requireOneOf<MemberStatus>(body.status, MEMBER_STATUSES, '状态');
  await updateMemberStatus(c.env.DB, target.id, status);
  if (status !== 'active') {
    await revokeAllSessions(c.env.DB, target.id);
    c.executionCtx.waitUntil(revokeMemberEverywhere(c.env, target.id));
  }
  return c.json({ ok: true });
});

adminRoutes.post('/members/:id/enrollment', async (c) => {
  const actor = c.get('member');
  if (actor.role !== 'superadmin') throw forbidden('只有系统管理员可以更正入学年份');
  const target = await findMemberById(c.env.DB, c.req.param('id'));
  if (!target) throw notFound('成员不存在');
  if (target.role === 'honorary_external') throw badRequest('external_advisor', '校外荣誉顾问没有入学年份');
  const body = await readJson<Record<string, unknown>>(c);
  const year = requireInteger(body.graduationYear, '入学年份');
  if (!isValidAdminEnrollmentYear(year)) throw badRequest('invalid_year', '入学年份无效');
  const requested = body.enrollmentStatus === undefined
    ? target.enrollment_status
    : requireOneOf<EnrollmentStatus>(body.enrollmentStatus, ENROLLMENT_STATUSES, '在读状态');
  const status: EnrollmentStatus = shouldGraduate(year, 'student') ? 'alumni' : requested;
  await correctEnrollment(c.env.DB, target, year, status);
  await recordJoinChanges(c.env, target);
  c.executionCtx.waitUntil(revokeMemberEverywhere(c.env, target.id));
  return c.json({ ok: true, graduationYear: year, enrollmentStatus: status });
});

adminRoutes.get('/enrollment-year-requests', async (c) => {
  if (c.get('member').role !== 'superadmin') throw forbidden('只有系统管理员可以查看入学年份申请');
  const rows = await listPendingYearRequests(c.env.DB);
  return c.json({
    requests: rows.map((row) => ({
      id: row.id,
      memberId: row.member_id,
      displayName: row.display_name,
      email: row.email,
      currentYear: row.graduation_year,
      requestedYear: row.requested_year,
      createdAt: row.created_at,
    })),
  });
});

adminRoutes.post('/enrollment-year-requests/:id/:decision', async (c) => {
  const actor = c.get('member');
  if (actor.role !== 'superadmin') throw forbidden('只有系统管理员可以处理入学年份申请');
  const decision = requireOneOf(c.req.param('decision'), ['approve', 'reject'] as const, '决定');
  const request = await findYearRequest(c.env.DB, c.req.param('id'));
  if (!request || request.status !== 'pending') throw notFound('申请不存在或已处理');
  const target = decision === 'approve' ? await findMemberById(c.env.DB, request.member_id) : null;
  if (decision === 'approve') {
    if (!isValidEnrollmentYear(request.requested_year)) throw badRequest('invalid_year', '入学年份无效');
    if (!target) throw notFound('成员不存在');
  }
  // Claim the request first so a double click or a racing reject cannot apply it twice.
  // 先占下这条申请，双击或同时拒绝都不会让它生效两次。
  if (!(await reviewYearRequest(c.env.DB, request.id, decision === 'approve' ? 'approved' : 'rejected', actor.id))) {
    throw notFound('申请不存在或已处理');
  }
  if (target) {
    const status: EnrollmentStatus = shouldGraduate(request.requested_year, 'student') ? 'alumni' : target.enrollment_status;
    await correctEnrollment(c.env.DB, target, request.requested_year, status);
    await recordJoinChanges(c.env, target);
    c.executionCtx.waitUntil(revokeMemberEverywhere(c.env, target.id));
  }
  const mail = enrollmentYearDecisionMail(request.email, request.display_name, request.requested_year, decision === 'approve');
  c.executionCtx.waitUntil(sendMail(mailConfig(c.env), mail));
  return c.json({ ok: true, status: decision === 'approve' ? 'approved' : 'rejected' });
});

/* Events */

adminRoutes.get('/events', requirePermission('events.manage'), async (c) => {
  const rows = await listAllEvents(c.env.DB);
  return c.json({ events: rows.map(toEvent) });
});

adminRoutes.post('/events', requirePermission('events.manage'), async (c) => {
  const body = await readJson<Record<string, unknown>>(c);
  const title = requireString(body.title, '活动名称', 80);
  const startsAtRaw = requireString(body.startsAt, '开始时间', 40);
  const startsAt = new Date(startsAtRaw);
  if (Number.isNaN(startsAt.getTime())) throw badRequest('invalid_date', '开始时间无效');
  const row = await createEvent(c.env.DB, {
    title,
    startsAt: startsAt.toISOString(),
    location: optionalString(body.location, '地点', 120),
    description: optionalString(body.description, '说明', 1000),
    createdBy: c.get('member').id,
  });
  return c.json({ event: toEvent(row) }, 201);
});

adminRoutes.delete('/events/:id', requirePermission('events.manage'), async (c) => {
  await deleteEvent(c.env.DB, c.req.param('id'));
  return c.json({ ok: true });
});

/* Announcements */

const EMAIL_BATCH = 50;

adminRoutes.post('/announcements', rateLimit(5, 60_000), requirePermission('announcements.send'), async (c) => {
  const body = await readJson<Record<string, unknown>>(c);
  const title = requireString(body.title, '标题', 80);
  const text = requireString(body.body, '正文', 5000);
  const sendEmail = body.sendEmail === true;
  const recipients = await listActiveMemberEmails(c.env.DB);

  if (sendEmail) {
    // Brevo accepts many recipients per call; batches keep each request small and let one failure
    // affect only its batch.
    // Brevo 单次可带多名收件人；分批使每次请求较小，一次失败只影响该批。
    const config = mailConfig(c.env);
    const batches: Promise<boolean>[] = [];
    for (let i = 0; i < recipients.length; i += EMAIL_BATCH) {
      const slice = recipients.slice(i, i + EMAIL_BATCH).map((r) => ({ email: r.email, name: r.display_name }));
      batches.push(sendMail(config, announcementMail(slice, title, text, c.env.APP_BASE_URL)));
    }
    c.executionCtx.waitUntil(
      Promise.all(batches).then((results) => {
        const failed = results.filter((ok) => !ok).length;
        if (failed > 0) console.error(`announcement mail: ${failed} of ${results.length} batches failed`);
      }),
    );
  }

  await recordAnnouncement(c.env.DB, { title, body: text, sentBy: c.get('member').id, recipientCount: recipients.length, emailed: sendEmail });
  const response: AnnouncementResponse = { recipientCount: recipients.length, emailed: sendEmail };
  return c.json(response, 201);
});

adminRoutes.get('/advisor-invites', async (c) => {
  if (c.get('member').role !== 'superadmin') throw forbidden('只有系统管理员可以邀请校外荣誉顾问');
  const rows = await listOpenInvites(c.env.DB);
  return c.json({
    invites: rows.map((row) => ({ id: row.id, email: row.email, expiresAt: row.expires_at, createdAt: row.created_at })),
  });
});

adminRoutes.post('/advisor-invites', async (c) => {
  const actor = c.get('member');
  if (actor.role !== 'superadmin') throw forbidden('只有系统管理员可以邀请校外荣誉顾问');
  const body = await readJson<Record<string, unknown>>(c);
  const email = normalizeEmail(requireString(body.email, '邮箱', 254));
  if (!isWellFormedEmail(email)) throw badRequest('invalid_email', '邮箱格式错误');
  if (isUniversityEmail(email)) throw badRequest('university_email', '校友荣誉顾问请先用学校邮箱注册，再在成员身份里指定');
  if (await findMemberByEmail(c.env.DB, email)) throw badRequest('already_registered', '这个邮箱已经注册');
  const lang = body.lang === 'en' ? 'en' : 'zh';
  const invite = await issueAdvisorInvite(c.env.DB, email, actor.id);
  const link = `${c.env.APP_BASE_URL}register?invite=${encodeURIComponent(invite.token)}`;
  const sent = await sendMail(mailConfig(c.env), advisorInviteMail(email, link, lang));
  if (!sent) {
    // The earlier invite, if any, still works because it is retired only after a successful send.
    // 之前的邀请仍然有效，只有新邮件发送成功后才作废旧邀请。
    await consumeAdvisorInvite(c.env.DB, invite.id);
    throw badRequest('mail_failed', '邮件发送失败，请稍后再试');
  }
  await retireOtherInvites(c.env.DB, email, invite.id);
  return c.json({ ok: true, email, expiresAt: invite.expiresAt }, 201);
});
