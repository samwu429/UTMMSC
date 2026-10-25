import { Hono } from 'hono';
import { adminCountsFor, adminSectionsFor, canHoldEnrollment, enrollmentForRole, ENROLLMENT_STATUSES, MEMBER_STATUSES, ROLES, canAssignRole, isHonoraryRole, isOfficeRole, isUniversityEmail, isValidAdminEnrollmentYear, isValidEnrollmentYear, isWellFormedEmail, normalizeEmail, roleTier, shouldGraduate, type AdminAnnouncementsResponse, type AdminEventRecord, type AdminEventsResponse, type AdminMemberRow, type AdminSummaryResponse, type AnnouncementResponse, type CreateEventResponse, type EnrollmentStatus, type MemberStatus, type Role } from '@utmmsc/shared';
import { readEventNotificationPlan, scheduleEventNotifications } from '../../../domain/notifications/event-plan';
import { loadAdminCounts } from '../../../infrastructure/d1/admin-summary';
import { ANNOUNCEMENT_PAGE, listAnnouncements, recordAnnouncement } from '../../../infrastructure/d1/announcements';
import { recordEligibilityChange } from '../../../infrastructure/d1/channel-joins';
import { listChannels } from '../../../infrastructure/d1/channels';
import { findApplication, listPendingApplications, reviewApplication, toApplication } from '../../../infrastructure/d1/applications';
import { cancelPendingNotices, listNoticesForEvents, toNotificationRow, type EventNoticeRow } from '../../../infrastructure/d1/event-notifications';
import { createEvent, deleteEvent, listAllEvents, toEvent, type EventRow } from '../../../infrastructure/d1/events';
import { dispatchEventNotice } from '../../../infrastructure/push/event-notices';
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
  viewedActor,
  viewedRole,
} from '../../../infrastructure/d1/members';
import { revokeAllSessions } from '../../../infrastructure/d1/sessions';
import { nowIso } from '../../../infrastructure/d1/time';
import { sendMail } from '../../../infrastructure/email/brevo';
import { announcementMail, applicationApprovedMail, applicationRejectedMail, advisorInviteMail, enrollmentYearDecisionMail } from '../../../infrastructure/email/templates';
import { findYearRequest, listPendingYearRequests, reviewYearRequest } from '../../../infrastructure/d1/enrollment-requests';
import { consumeAdvisorInvite, issueAdvisorInvite, listOpenInvites, retireOtherInvites } from '../../../infrastructure/d1/advisor-invites';
import { memberRateLimit, rateLimit } from '../../middleware/rate-limit';
import { recordJoinChanges } from '../../access';
import { revokeMemberEverywhere } from '../../rooms';
import type { AppEnv } from '../../context';
import { badRequest, forbidden, notFound } from '../../errors';
import { requirePermission, requireSession } from '../../middleware/session';
import { optionalString, readJson, requireInteger, requireOneOf, requireString } from '../../validation';
import { MINUTE, cursorOut, readCursor } from '../moments/common';

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
 * The admin sections the viewed role sees and the counts of only those sections, for the dashboard, the sidebar and
 * the red count on 发现 → 管理. Open to every member: a role without sections gets empty lists and runs no query.
 * 当前视角身份能看到的管理板块，以及仅属于这些板块的计数，供管理首页、侧边栏和「发现 → 管理」上的红色数字使用。
 * 对所有成员开放：没有板块的身份得到空结果，不执行任何查询。
 */
adminRoutes.get('/summary', memberRateLimit('admin:summary', 60, MINUTE), async (c) => {
  const member = c.get('member');
  const role = viewedRole(member);
  const response: AdminSummaryResponse = {
    sections: adminSectionsFor(role),
    counts: await loadAdminCounts(c.env.DB, adminCountsFor(role), { viewerId: member.id, now: nowIso() }),
  };
  return c.json(response);
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
  // 在校生 and 毕业生 are enrollment statuses as well as roles; channel access reads enrollment, so both move together.
  // 在校生和毕业生既是身份也是在读状态；频道权限按在读状态判断，所以二者一起变更。
  const implied = enrollmentForRole(role);
  if (implied === 'student' && shouldGraduate(target.graduation_year, 'student')) {
    throw badRequest('already_graduated', '入学已满五年，只能是毕业生');
  }
  // An office says nothing about enrollment, so the member keeps theirs unless the request names one: 撤销 sends the
  // status from before the change, which 在校生 or 毕业生 moved. Five years after enrollment it stays 毕业生.
  // 职位不涉及在读状态，所以成员保留自己的在读状态，除非请求中指定了一个：「撤销」会带上修改之前的状态，因为改为在校生或毕业生时它随之改变。
  // 入学满五年后仍为毕业生。
  const requested = implied !== null || body.enrollmentStatus === undefined
    ? null
    : requireOneOf<EnrollmentStatus>(body.enrollmentStatus, ENROLLMENT_STATUSES, '在读状态');
  const restored = requested === 'student' && shouldGraduate(target.graduation_year, 'student') ? 'alumni' : requested;
  const enrollmentStatus = implied ?? restored ?? target.enrollment_status;
  await updateMemberRole(c.env.DB, target.id, role, enrollmentStatus);
  // A role change also ends any test identity, so access before the change is measured from the real role.
  // 身份改变时测试身份也随之结束，因此变更之前的权限按真实身份计算。
  await recordJoinChanges(c.env, role === target.role ? target : { ...target, acting_role: null });
  c.executionCtx.waitUntil(revokeMemberEverywhere(c.env, target.id));
  return c.json({ ok: true, role, enrollmentStatus });
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
  // Holders who are not active do not block an appointment, so a restored holder may find their office taken.
  // 非在用的任职者不占用职位，所以恢复的任职者可能发现职位已有他人担任。
  if (status === 'active' && isOfficeRole(target.role) && (await officeHolderExists(c.env.DB, target.role, target.id))) {
    throw badRequest('office_taken', '这个职位已经有人担任，请先给他换一个身份');
  }
  await updateMemberStatus(c.env.DB, target.id, status);
  if (status !== 'active') {
    await revokeAllSessions(c.env.DB, target.id);
    c.executionCtx.waitUntil(revokeMemberEverywhere(c.env, target.id));
  } else if (target.status !== 'active') {
    // Audience changes skip members who are not active, so a restored member joins every audience channel they can read now.
    // 受众变更会跳过非在用的成员，所以恢复的成员从现在起加入其当前能阅读的每个受众频道。
    await recordEligibilityChange(c.env.DB, target.id, null, viewedActor(target), await listChannels(c.env.DB));
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
  if (!canHoldEnrollment(target.role, status)) throw badRequest('honorary_alumni', '荣誉顾问只能是毕业生');
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
    // An honorary advisor stays alumni even if their stored status still says otherwise.
    // 荣誉顾问始终是毕业生，即使库中的状态仍是别的值。
    const keep = canHoldEnrollment(target.role, target.enrollment_status) ? target.enrollment_status : 'alumni';
    const status: EnrollmentStatus = shouldGraduate(request.requested_year, 'student') ? 'alumni' : keep;
    await correctEnrollment(c.env.DB, target, request.requested_year, status);
    await recordJoinChanges(c.env, target);
    c.executionCtx.waitUntil(revokeMemberEverywhere(c.env, target.id));
  }
  const mail = enrollmentYearDecisionMail(request.email, request.display_name, request.requested_year, decision === 'approve');
  c.executionCtx.waitUntil(sendMail(mailConfig(c.env), mail));
  return c.json({ ok: true, status: decision === 'approve' ? 'approved' : 'rejected' });
});

/* Events */

function toAdminEvent(row: EventRow, notices: readonly EventNoticeRow[]): AdminEventRecord {
  return { ...toEvent(row), notifications: notices.map(toNotificationRow) };
}

adminRoutes.get('/events', requirePermission('events.manage'), async (c) => {
  const rows = await listAllEvents(c.env.DB);
  const notices = await listNoticesForEvents(c.env.DB, rows.map((row) => row.id));
  const response: AdminEventsResponse = { events: rows.map((row) => toAdminEvent(row, notices.get(row.id) ?? [])) };
  return c.json(response);
});

adminRoutes.post('/events', requirePermission('events.manage'), async (c) => {
  const body = await readJson<Record<string, unknown>>(c);
  const title = requireString(body.title, '活动名称', 80);
  const startsAtRaw = requireString(body.startsAt, '开始时间', 40);
  const startsAt = new Date(startsAtRaw);
  if (Number.isNaN(startsAt.getTime())) throw badRequest('invalid_date', '开始时间无效');
  const plan = readEventNotificationPlan(body.notifications);
  if (!plan.ok) throw badRequest(plan.error.code, plan.error.message);
  const schedule = scheduleEventNotifications({ startsAt: startsAt.toISOString(), plan: plan.value, now: new Date() });
  if (!schedule.ok) throw badRequest(schedule.error.code, schedule.error.message);
  const { row, notices } = await createEvent(
    c.env.DB,
    {
      title,
      startsAt: startsAt.toISOString(),
      location: optionalString(body.location, '地点', 120),
      description: optionalString(body.description, '说明', 1000),
      createdBy: c.get('member').id,
    },
    schedule.value,
  );
  // The publish notice is claimed like any due row, so a cron run at the same moment cannot send it twice.
  // 发布通知与其他到期的行一样先领取再发送，同一时刻运行的定时任务不会重复发送。
  const publish = notices.find((notice) => notice.kind === 'publish');
  if (publish) c.executionCtx.waitUntil(dispatchEventNotice(c.env, publish.id));
  const response: CreateEventResponse = { event: toAdminEvent(row, notices) };
  return c.json(response, 201);
});

adminRoutes.delete('/events/:id', requirePermission('events.manage'), async (c) => {
  const id = c.req.param('id');
  // Notice rows also cascade away with the event; cancelling first covers a database without cascades.
  // 通知行也会随活动级联删除；先取消可以覆盖不执行级联的数据库。
  await cancelPendingNotices(c.env.DB, id);
  await deleteEvent(c.env.DB, id);
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
  // Recorded before any mail starts: if the write fails, nothing was sent and a retry is safe; once mail is on its
  // way, the history already shows it, so nobody sends the same announcement twice.
  // 在任何邮件发出之前先记录：写入失败时什么都没发出，重试是安全的；邮件一旦开始发送，公告记录里已经有它，就不会有人把同一条公告发两遍。
  await recordAnnouncement(c.env.DB, { title, body: text, sentBy: c.get('member').id, recipientCount: recipients.length, emailed: sendEmail });

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

  const response: AnnouncementResponse = { recipientCount: recipients.length, emailed: sendEmail };
  return c.json(response, 201);
});

/** Sent announcements, newest first, 20 a page; ?cursor is the nextCursor of the previous page. */
/** 已发送的公告，从新到旧，每页 20 条；?cursor 为上一页返回的 nextCursor。 */
adminRoutes.get('/announcements', requirePermission('announcements.send'), async (c) => {
  const page = await listAnnouncements(c.env.DB, { cursor: readCursor(c.req.query('cursor')), limit: ANNOUNCEMENT_PAGE });
  const response: AdminAnnouncementsResponse = { announcements: page.announcements, nextCursor: cursorOut(page.nextCursor) };
  return c.json(response);
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
