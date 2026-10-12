import { Hono } from 'hono';
import { ENROLLMENT_STATUSES, MEMBER_STATUSES, ROLES, canAssignRole, isOfficeRole, isValidAdminEnrollmentYear, roleTier, shouldGraduate, type AdminMemberRow, type AnnouncementResponse, type EnrollmentStatus, type MemberStatus, type Role } from '@utmmsc/shared';
import { recordAnnouncement } from '../../../infrastructure/d1/announcements';
import { findApplication, listPendingApplications, reviewApplication, toApplication } from '../../../infrastructure/d1/applications';
import { createEvent, deleteEvent, listAllEvents, toEvent } from '../../../infrastructure/d1/events';
import {
  findMemberById,
  listActiveMemberEmails,
  listAllMembersForAdmin,
  toProfile,
  toSelf,
  updateMemberRole,
  updateMemberStatus,
  updateActingRole,
  officeHolderExists,
  correctEnrollment,
} from '../../../infrastructure/d1/members';
import { revokeAllSessions } from '../../../infrastructure/d1/sessions';
import { sendMail } from '../../../infrastructure/email/brevo';
import { announcementMail, applicationApprovedMail, applicationRejectedMail, enrollmentYearDecisionMail } from '../../../infrastructure/email/templates';
import { findYearRequest, listPendingYearRequests, reviewYearRequest } from '../../../infrastructure/d1/enrollment-requests';
import type { AppEnv } from '../../context';
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
  const updated = await findMemberById(c.env.DB, actor.id);
  if (!updated) throw notFound('成员不存在');
  return c.json({ member: toSelf(updated) });
});

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
  await reviewApplication(c.env.DB, application.id, status, c.get('member').id);
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
  if (!canAssignRole(actor.role, role)) throw forbidden('无权分配该身份');
  if (roleTier(target.role) >= roleTier(actor.role) && actor.role !== 'superadmin') throw forbidden('无权修改该成员');
  if (isOfficeRole(role) && (await officeHolderExists(c.env.DB, role, target.id))) throw badRequest('office_taken', '这个职位已经有人担任');
  await updateMemberRole(c.env.DB, target.id, role);
  return c.json({ ok: true });
});

adminRoutes.post('/members/:id/status', requirePermission('members.assign_role'), async (c) => {
  const actor = c.get('member');
  const target = await findMemberById(c.env.DB, c.req.param('id'));
  if (!target) throw notFound('成员不存在');
  if (target.id === actor.id) throw badRequest('self_status', '不能停用自己');
  if (roleTier(target.role) >= roleTier(actor.role) && actor.role !== 'superadmin') throw forbidden('无权修改该成员');
  const body = await readJson<Record<string, unknown>>(c);
  const status = requireOneOf<MemberStatus>(body.status, MEMBER_STATUSES, '状态');
  await updateMemberStatus(c.env.DB, target.id, status);
  if (status !== 'active') await revokeAllSessions(c.env.DB, target.id);
  return c.json({ ok: true });
});

adminRoutes.post('/members/:id/enrollment', async (c) => {
  const actor = c.get('member');
  if (actor.role !== 'superadmin') throw forbidden('只有系统管理员可以更正入学年份');
  const target = await findMemberById(c.env.DB, c.req.param('id'));
  if (!target) throw notFound('成员不存在');
  const body = await readJson<Record<string, unknown>>(c);
  const year = requireInteger(body.graduationYear, '入学年份');
  if (!isValidAdminEnrollmentYear(year)) throw badRequest('invalid_year', '入学年份无效');
  const requested = body.enrollmentStatus === undefined
    ? target.enrollment_status
    : requireOneOf<EnrollmentStatus>(body.enrollmentStatus, ENROLLMENT_STATUSES, '在读状态');
  const status: EnrollmentStatus = shouldGraduate(year, 'student') ? 'alumni' : requested;
  await correctEnrollment(c.env.DB, target, year, status);
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
  if (decision === 'approve') {
    const target = await findMemberById(c.env.DB, request.member_id);
    if (!target) throw notFound('成员不存在');
    const status: EnrollmentStatus = shouldGraduate(request.requested_year, 'student') ? 'alumni' : target.enrollment_status;
    await correctEnrollment(c.env.DB, target, request.requested_year, status);
  }
  await reviewYearRequest(c.env.DB, request.id, decision === 'approve' ? 'approved' : 'rejected', actor.id);
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

adminRoutes.post('/announcements', requirePermission('announcements.send'), async (c) => {
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
    c.executionCtx.waitUntil(Promise.all(batches));
  }

  await recordAnnouncement(c.env.DB, { title, body: text, sentBy: c.get('member').id, recipientCount: recipients.length, emailed: sendEmail });
  const response: AnnouncementResponse = { recipientCount: recipients.length, emailed: sendEmail };
  return c.json(response, 201);
});
