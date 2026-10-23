import { Hono } from 'hono';
import {
  ENROLLMENT_STATUSES,
  PROGRAM_MAJOR_MAX,
  canonicalizeProgramMajor,
  enrollmentCalendarYear,
  isUniversityEmail,
  isValidDisplayName,
  enrollmentForEmail,
  isValidRegistrationYear,
  shouldGraduate,
  isValidPassword,
  isWellFormedEmail,
  normalizeEmail,
  type EnrollmentStatus,
  type Role,
  type SessionResponse,
} from '@utmmsc/shared';
import { timingSafeEqual, utf8ToBytes } from '../../../domain/crypto/encoding';
import { hashPassword, verifyPassword } from '../../../domain/identity/password';
import { issueProfileMediaToken } from '../../../domain/profile/media-token';
import { issueSessionToken } from '../../../domain/identity/session-token';
import {
  evaluateVerification,
  generateCode,
  hashCode,
  isCodeShape,
} from '../../../domain/identity/verification-code';
import {
  createApplication,
  findApprovedApplicationByEmail,
  hasPendingApplication,
} from '../../../infrastructure/d1/applications';
import { consumeAdvisorInvite, findLiveInviteByEmail, findLiveInviteByToken } from '../../../infrastructure/d1/advisor-invites';
import {
  countMembers,
  createMember,
  findMemberByEmail,
  toSelf,
  updatePasswordHash,
  type MemberRow,
} from '../../../infrastructure/d1/members';
import { removeSessionDevices } from '../../../infrastructure/d1/push-devices';
import { createSession, revokeAllSessions, revokeOtherSessions, revokeSession } from '../../../infrastructure/d1/sessions';
import { settleMember } from '../../access';
import {
  checkSendGate,
  consumeVerification,
  latestVerification,
  recordAttempt,
  storeVerification,
  type VerificationPurpose,
} from '../../../infrastructure/d1/verifications';
import { sendMail } from '../../../infrastructure/email/brevo';
import { verificationCodeMail } from '../../../infrastructure/email/templates';
import type { AppEnv } from '../../context';
import { badRequest, conflict, forbidden, tooMany, unauthorized } from '../../errors';
import { rateLimit } from '../../middleware/rate-limit';
import { requireSession } from '../../middleware/session';
import { optionalString, readJson, requireInteger, requireOneOf, requireString } from '../../validation';
import type { Env } from '../../../env';

function programMajor(value: string | null): string | null {
  const result = canonicalizeProgramMajor(value);
  if (!result.ok) throw badRequest('invalid_program', result.message);
  return result.major;
}

export const authRoutes = new Hono<AppEnv>();

async function startSession(env: Env, member: MemberRow): Promise<SessionResponse> {
  const session = await createSession(env.DB, member.id);
  const token = await issueSessionToken(env.SESSION_SECRET, session.id, member.id, session.expiresAt);
  const mediaToken = await issueProfileMediaToken(env.SESSION_SECRET);
  return { token, expiresAt: session.expiresAt.toISOString(), member: toSelf(member), mediaToken };
}

/**
 * Verifies a code for the given email and purpose. Attempts are counted before comparison so a
 * wrong guess always costs one try.
 * 校验某邮箱、某用途的验证码。比较前先计一次尝试，错误猜测一定消耗次数。
 */
async function verifyCodeOrThrow(env: Env, email: string, purpose: VerificationPurpose, code: string): Promise<void> {
  if (!isCodeShape(code)) throw badRequest('invalid_code', '验证码格式错误');
  const record = await latestVerification(env.DB, email, purpose);
  if (!record) throw badRequest('code_missing', '请先获取验证码');
  const state = evaluateVerification({ expiresAt: record.expires_at, attempts: record.attempts, consumedAt: record.consumed_at });
  if (state === 'expired') throw badRequest('code_expired', '验证码已过期，请重新获取');
  if (state === 'too_many_attempts') throw tooMany('尝试次数过多，请重新获取验证码');
  if (state === 'consumed') throw badRequest('code_missing', '请重新获取验证码');
  if (!(await recordAttempt(env.DB, record.id))) throw tooMany('尝试次数过多，请重新获取验证码');
  const expected = await hashCode(email, code);
  if (!timingSafeEqual(utf8ToBytes(expected), utf8ToBytes(record.code_hash))) throw badRequest('code_mismatch', '验证码不正确');
  if (!(await consumeVerification(env.DB, record.id))) throw badRequest('code_missing', '请重新获取验证码');
}

/** Two registrations for one address can race past the lookup; the UNIQUE index decides. */
/** 同一邮箱的两次注册可能同时通过查重；由唯一索引裁定。 */
async function createMemberOnce(env: Env, input: Parameters<typeof createMember>[1]): Promise<MemberRow> {
  try {
    return await createMember(env.DB, input);
  } catch (err) {
    if (err instanceof Error && /UNIQUE constraint failed/i.test(err.message)) throw conflict('already_registered', '该邮箱已注册，请直接登录');
    throw err;
  }
}

/** Unknown emails still pay for one hash so response time does not reveal who is registered. */
/** 未注册的邮箱也计算一次哈希，响应时间不会泄露哪些邮箱已注册。 */
let dummyHash: Promise<string> | null = null;
function timingDummyHash(): Promise<string> {
  dummyHash ??= hashPassword('timing-equaliser-not-a-password');
  return dummyHash;
}

authRoutes.post('/code', rateLimit(10, 60_000), async (c) => {
  const body = await readJson<Record<string, unknown>>(c);
  const email = normalizeEmail(requireString(body.email, '邮箱', 254));
  const purpose = requireOneOf(body.purpose, ['register', 'reset'] as const, '用途');
  if (!isWellFormedEmail(email)) throw badRequest('invalid_email', '邮箱格式错误');

  const existing = await findMemberByEmail(c.env.DB, email);
  if (purpose === 'register') {
    if (existing) throw conflict('already_registered', '该邮箱已注册，请直接登录');
    if (
      !isUniversityEmail(email) &&
      !(await findLiveInviteByEmail(c.env.DB, email)) &&
      !(await findApprovedApplicationByEmail(c.env.DB, email))
    ) {
      throw badRequest('not_university_email', '请使用多伦多大学邮箱，或提交人工申请');
    }
  } else if (!existing) {
    // Do not reveal which addresses are registered.
    // 不透露哪些地址已注册。
    return c.json({ ok: true });
  }

  const gate = await checkSendGate(c.env.DB, email, purpose);
  if (gate === 'too_soon') throw tooMany('请 60 秒后再获取验证码');
  if (gate === 'hourly_limit') throw tooMany('获取次数过多，请一小时后再试');

  const code = generateCode();
  await storeVerification(c.env.DB, email, purpose, await hashCode(email, code));
  const sent = await sendMail(
    { apiKey: c.env.BREVO_API_KEY, fromEmail: c.env.MAIL_FROM_EMAIL, fromName: c.env.MAIL_FROM_NAME },
    verificationCodeMail(email, code, purpose),
  );
  if (!sent) throw badRequest('mail_failed', '邮件发送失败，请稍后再试');
  return c.json({ ok: true });
});

authRoutes.get('/invite', rateLimit(30, 60_000), async (c) => {
  const token = c.req.query('token') ?? '';
  if (!token || token.length > 128) throw badRequest('invite_invalid', '邀请链接无效或已过期');
  const invite = await findLiveInviteByToken(c.env.DB, token);
  if (!invite) throw badRequest('invite_invalid', '邀请链接无效或已过期');
  return c.json({ email: invite.email });
});

authRoutes.post('/register', rateLimit(10, 60_000), async (c) => {
  const body = await readJson<Record<string, unknown>>(c);
  const email = normalizeEmail(requireString(body.email, '邮箱', 254));
  const password = requireString(body.password, '密码', 128);
  const displayName = requireString(body.displayName, '姓名', 40);
  const inviteToken = optionalString(body.invite, '邀请', 128);

  if (!isWellFormedEmail(email)) throw badRequest('invalid_email', '邮箱格式错误');
  if (!isValidPassword(password)) throw badRequest('weak_password', '密码至少 8 位');
  if (!isValidDisplayName(displayName)) throw badRequest('invalid_name', '姓名需 2 到 40 个字符');
  if (await findMemberByEmail(c.env.DB, email)) throw conflict('already_registered', '该邮箱已注册，请直接登录');

  if (inviteToken) {
    const invite = await findLiveInviteByToken(c.env.DB, inviteToken);
    if (!invite || invite.email !== email) throw badRequest('invite_invalid', '邀请链接无效或已过期');
    if (isUniversityEmail(email)) throw badRequest('university_email', '校友荣誉顾问请使用学校邮箱自行注册');
    await verifyCodeOrThrow(c.env, email, 'register', requireString(body.code, '验证码', 6));
    const member = await createMemberOnce(c.env, {
      email,
      displayName,
      passwordHash: await hashPassword(password),
      role: 'honorary_external',
      enrollmentStatus: 'alumni',
      graduationYear: enrollmentCalendarYear(),
      major: null,
    });
    await consumeAdvisorInvite(c.env.DB, invite.id);
    return c.json(await startSession(c.env, member), 201);
  }

  // mail.utoronto.ca is always a student and alumni.utoronto.ca always a graduate; only other addresses choose.
  // mail.utoronto.ca 一律为在校生，alumni.utoronto.ca 一律为毕业生；其他邮箱才由本人选择。
  const impliedStatus = enrollmentForEmail(email);
  let enrollmentStatus = impliedStatus ?? requireOneOf<EnrollmentStatus>(body.enrollmentStatus, ENROLLMENT_STATUSES, '在读状态');
  let graduationYear = requireInteger(body.graduationYear, '入学年份');
  const major = programMajor(optionalString(body.major, '专业', PROGRAM_MAJOR_MAX));

  if (!isUniversityEmail(email)) {
    // A manual approval covers what the reviewer saw; the applicant still proves they own the inbox.
    // 人工审核只认可审核时看到的资料；申请人仍需证明自己拥有该邮箱。
    const approved = await findApprovedApplicationByEmail(c.env.DB, email);
    if (!approved) throw forbidden('该邮箱尚未通过人工审核');
    enrollmentStatus = approved.enrollment_status;
    graduationYear = approved.graduation_year;
  } else if (!isValidRegistrationYear(graduationYear, enrollmentStatus)) {
    throw badRequest('invalid_year', '入学年份无效');
  }
  await verifyCodeOrThrow(c.env, email, 'register', requireString(body.code, '验证码', 6));

  // The first account bootstraps administration; everyone after that starts as a plain member.
  // Invite registration never uses this path.
  // 第一个账号作为初始管理员；之后的账号都是普通成员。邀请注册不走这里。
  const role: Role = (await countMembers(c.env.DB)) === 0 ? 'superadmin' : (shouldGraduate(graduationYear, 'student') ? 'alumni' : enrollmentStatus);
  const member = await createMemberOnce(c.env, {
    email,
    displayName,
    passwordHash: await hashPassword(password),
    role,
    enrollmentStatus: shouldGraduate(graduationYear, enrollmentStatus) ? 'alumni' : enrollmentStatus,
    graduationYear,
    major,
  });
  return c.json(await startSession(c.env, member), 201);
});

authRoutes.post('/login', rateLimit(20, 60_000), async (c) => {
  const body = await readJson<Record<string, unknown>>(c);
  const email = normalizeEmail(requireString(body.email, '邮箱', 254));
  const password = requireString(body.password, '密码', 128);
  const member = await findMemberByEmail(c.env.DB, email);
  const valid = await verifyPassword(password, member ? member.password_hash : await timingDummyHash());
  if (!member || !valid) throw unauthorized('邮箱或密码不正确');
  if (member.status !== 'active') throw forbidden('账号已停用，请联系主席团');
  return c.json(await startSession(c.env, await settleMember(c.env, c.executionCtx, member)));
});

authRoutes.post('/reset', rateLimit(10, 60_000), async (c) => {
  const body = await readJson<Record<string, unknown>>(c);
  const email = normalizeEmail(requireString(body.email, '邮箱', 254));
  const code = requireString(body.code, '验证码', 6);
  const password = requireString(body.password, '密码', 128);
  if (!isValidPassword(password)) throw badRequest('weak_password', '密码至少 8 位');
  const member = await findMemberByEmail(c.env.DB, email);
  if (!member) throw badRequest('code_mismatch', '验证码不正确');
  await verifyCodeOrThrow(c.env, email, 'reset', code);
  if (member.status !== 'active') throw forbidden('账号已停用，请联系主席团');
  await updatePasswordHash(c.env.DB, member.id, await hashPassword(password));
  await revokeAllSessions(c.env.DB, member.id);
  return c.json(await startSession(c.env, await settleMember(c.env, c.executionCtx, member)));
});

authRoutes.post('/apply', rateLimit(5, 60_000), async (c) => {
  const body = await readJson<Record<string, unknown>>(c);
  const email = normalizeEmail(requireString(body.email, '邮箱', 254));
  const displayName = requireString(body.displayName, '姓名', 40);
  const enrollmentStatus = requireOneOf<EnrollmentStatus>(body.enrollmentStatus, ENROLLMENT_STATUSES, '在读状态');
  const graduationYear = requireInteger(body.graduationYear, '入学年份');
  const major = programMajor(optionalString(body.major, '专业', PROGRAM_MAJOR_MAX));
  const note = optionalString(body.note, '备注', 500);
  if (!isWellFormedEmail(email)) throw badRequest('invalid_email', '邮箱格式错误');
  if (!isValidDisplayName(displayName)) throw badRequest('invalid_name', '姓名需 2 到 40 个字符');
  if (!isValidRegistrationYear(graduationYear, enrollmentStatus)) throw badRequest('invalid_year', '入学年份无效');
  if (await findMemberByEmail(c.env.DB, email)) throw conflict('already_registered', '该邮箱已注册，请直接登录');
  if (await hasPendingApplication(c.env.DB, email)) throw conflict('already_applied', '申请已提交，请等待审核');
  await createApplication(c.env.DB, {
    email,
    displayName,
    enrollmentStatus: shouldGraduate(graduationYear, enrollmentStatus) ? 'alumni' : enrollmentStatus,
    graduationYear,
    major,
    note,
  });
  return c.json({ ok: true }, 201);
});

authRoutes.get('/me', requireSession, async (c) => {
  return c.json({ member: toSelf(c.get('member')), mediaToken: await issueProfileMediaToken(c.env.SESSION_SECRET) });
});

authRoutes.post('/logout', requireSession, async (c) => {
  await revokeSession(c.env.DB, c.get('sessionId'));
  // A device signed out here must not keep receiving pushes, even if the client could not unregister it.
  // 在此退出登录的设备不能继续收到推送，即使客户端没能注销它。
  await removeSessionDevices(c.env.DB, c.get('sessionId'));
  return c.json({ ok: true });
});

authRoutes.post('/password', requireSession, async (c) => {
  const body = await readJson<Record<string, unknown>>(c);
  const current = requireString(body.currentPassword, '当前密码', 128);
  const next = requireString(body.newPassword, '新密码', 128);
  if (!isValidPassword(next)) throw badRequest('weak_password', '密码至少 8 位');
  const member = c.get('member');
  // 400, not 401: the session is fine, and the client signs out on any 401.
  // 返回 400 而不是 401：会话本身有效，而客户端遇到 401 会直接退出登录。
  if (!(await verifyPassword(current, member.password_hash))) throw badRequest('wrong_password', '当前密码不正确');
  await updatePasswordHash(c.env.DB, member.id, await hashPassword(next));
  // A changed password should end any session that may have leaked, except this one.
  // 改密码后结束其他可能泄露的会话，只保留当前这个。
  await revokeOtherSessions(c.env.DB, member.id, c.get('sessionId'));
  return c.json({ ok: true });
});
