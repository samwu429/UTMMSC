import { Hono } from 'hono';
import {
  ENROLLMENT_STATUSES,
  isUniversityEmail,
  isValidDisplayName,
  isValidGraduationYear,
  isValidPassword,
  isWellFormedEmail,
  normalizeEmail,
  type EnrollmentStatus,
  type Role,
  type SessionResponse,
} from '@utmmsc/shared';
import { hashPassword, verifyPassword } from '../../../domain/identity/password';
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
import {
  countMembers,
  createMember,
  findMemberByEmail,
  toSelf,
  updatePasswordHash,
  type MemberRow,
} from '../../../infrastructure/d1/members';
import { createSession, revokeAllSessions, revokeSession } from '../../../infrastructure/d1/sessions';
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

export const authRoutes = new Hono<AppEnv>();

async function startSession(env: Env, member: MemberRow): Promise<SessionResponse> {
  const session = await createSession(env.DB, member.id);
  const token = await issueSessionToken(env.SESSION_SECRET, session.id, member.id, session.expiresAt);
  return { token, expiresAt: session.expiresAt.toISOString(), member: toSelf(member) };
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
  await recordAttempt(env.DB, record.id);
  const expected = await hashCode(email, code);
  if (expected !== record.code_hash) throw badRequest('code_mismatch', '验证码不正确');
  await consumeVerification(env.DB, record.id);
}

authRoutes.post('/code', rateLimit(10, 60_000), async (c) => {
  const body = await readJson<Record<string, unknown>>(c);
  const email = normalizeEmail(requireString(body.email, '邮箱', 254));
  const purpose = requireOneOf(body.purpose, ['register', 'reset'] as const, '用途');
  if (!isWellFormedEmail(email)) throw badRequest('invalid_email', '邮箱格式错误');

  const existing = await findMemberByEmail(c.env.DB, email);
  if (purpose === 'register') {
    if (!isUniversityEmail(email)) throw badRequest('not_university_email', '请使用多伦多大学邮箱，或提交人工申请');
    if (existing) throw conflict('already_registered', '该邮箱已注册，请直接登录');
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

authRoutes.post('/register', rateLimit(10, 60_000), async (c) => {
  const body = await readJson<Record<string, unknown>>(c);
  const email = normalizeEmail(requireString(body.email, '邮箱', 254));
  const password = requireString(body.password, '密码', 128);
  const displayName = requireString(body.displayName, '姓名', 40);
  const enrollmentStatus = requireOneOf<EnrollmentStatus>(body.enrollmentStatus, ENROLLMENT_STATUSES, '在读状态');
  const graduationYear = requireInteger(body.graduationYear, '毕业年份');
  const major = optionalString(body.major, '专业', 80);

  if (!isWellFormedEmail(email)) throw badRequest('invalid_email', '邮箱格式错误');
  if (!isValidPassword(password)) throw badRequest('weak_password', '密码至少 8 位');
  if (!isValidDisplayName(displayName)) throw badRequest('invalid_name', '姓名需 2 到 40 个字符');
  if (!isValidGraduationYear(graduationYear)) throw badRequest('invalid_year', '毕业年份无效');
  if (await findMemberByEmail(c.env.DB, email)) throw conflict('already_registered', '该邮箱已注册，请直接登录');

  if (isUniversityEmail(email)) {
    await verifyCodeOrThrow(c.env, email, 'register', requireString(body.code, '验证码', 6));
  } else {
    const approved = await findApprovedApplicationByEmail(c.env.DB, email);
    if (!approved) throw forbidden('该邮箱尚未通过人工审核');
  }

  // The first account bootstraps administration; everyone after that starts as a plain member.
  // 第一个账号作为初始管理员；之后的账号都是普通成员。
  const role: Role = (await countMembers(c.env.DB)) === 0 ? 'superadmin' : enrollmentStatus;
  const member = await createMember(c.env.DB, {
    email,
    displayName,
    passwordHash: await hashPassword(password),
    role,
    enrollmentStatus,
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
  const valid = member ? await verifyPassword(password, member.password_hash) : false;
  if (!member || !valid) throw unauthorized('邮箱或密码不正确');
  if (member.status !== 'active') throw forbidden('账号已停用，请联系主席团');
  return c.json(await startSession(c.env, member));
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
  await updatePasswordHash(c.env.DB, member.id, await hashPassword(password));
  await revokeAllSessions(c.env.DB, member.id);
  return c.json(await startSession(c.env, member));
});

authRoutes.post('/apply', rateLimit(5, 60_000), async (c) => {
  const body = await readJson<Record<string, unknown>>(c);
  const email = normalizeEmail(requireString(body.email, '邮箱', 254));
  const displayName = requireString(body.displayName, '姓名', 40);
  const enrollmentStatus = requireOneOf<EnrollmentStatus>(body.enrollmentStatus, ENROLLMENT_STATUSES, '在读状态');
  const graduationYear = requireInteger(body.graduationYear, '毕业年份');
  const major = optionalString(body.major, '专业', 80);
  const note = optionalString(body.note, '备注', 500);
  if (!isWellFormedEmail(email)) throw badRequest('invalid_email', '邮箱格式错误');
  if (!isValidDisplayName(displayName)) throw badRequest('invalid_name', '姓名需 2 到 40 个字符');
  if (!isValidGraduationYear(graduationYear)) throw badRequest('invalid_year', '毕业年份无效');
  if (await findMemberByEmail(c.env.DB, email)) throw conflict('already_registered', '该邮箱已注册，请直接登录');
  if (await hasPendingApplication(c.env.DB, email)) throw conflict('already_applied', '申请已提交，请等待审核');
  await createApplication(c.env.DB, { email, displayName, enrollmentStatus, graduationYear, major, note });
  return c.json({ ok: true }, 201);
});

authRoutes.get('/me', requireSession, (c) => c.json({ member: toSelf(c.get('member')) }));

authRoutes.post('/logout', requireSession, async (c) => {
  await revokeSession(c.env.DB, c.get('sessionId'));
  return c.json({ ok: true });
});

authRoutes.post('/password', requireSession, async (c) => {
  const body = await readJson<Record<string, unknown>>(c);
  const current = requireString(body.currentPassword, '当前密码', 128);
  const next = requireString(body.newPassword, '新密码', 128);
  if (!isValidPassword(next)) throw badRequest('weak_password', '密码至少 8 位');
  const member = c.get('member');
  if (!(await verifyPassword(current, member.password_hash))) throw unauthorized('当前密码不正确');
  await updatePasswordHash(c.env.DB, member.id, await hashPassword(next));
  return c.json({ ok: true });
});
