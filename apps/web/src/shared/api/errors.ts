import { useLocaleStore } from '../i18n/locale';

const ENGLISH: Record<string, string> = {
  '邮箱或密码不正确': 'The email or password is incorrect.',
  '当前密码不正确': 'The current password is incorrect.',
  '登录已过期，请重新登录': 'Your session expired. Sign in again.',
  '登录已失效，请重新登录': 'Your session is no longer valid. Sign in again.',
  '请先登录': 'Please sign in.',
  '账号不可用': 'This account is not available.',
  '账号已停用，请联系主席团': 'This account is disabled. Contact the presidium.',
  '验证码格式错误': 'That code is not valid.',
  '请先获取验证码': 'Request a code first.',
  '验证码已过期，请重新获取': 'That code expired. Request a new one.',
  '请重新获取验证码': 'Request a new code.',
  '验证码不正确': 'That code is incorrect.',
  '邮箱格式错误': 'That email address is not valid.',
  '该邮箱已注册，请直接登录': 'This email is already registered. Sign in instead.',
  '这个邮箱已经注册': 'This email is already registered.',
  '请使用多伦多大学邮箱，或提交人工申请': 'Use a University of Toronto email, or submit a manual application.',
  '请 60 秒后再获取验证码': 'Wait 60 seconds before requesting another code.',
  '获取次数过多，请一小时后再试': 'Too many codes. Try again in an hour.',
  '邮件发送失败，请稍后再试': 'The email could not be sent. Try again in a moment.',
  '邀请链接无效或已过期': 'This invitation link is invalid or has expired.',
  '密码至少 8 位': 'Use at least 8 characters.',
  '姓名需 2 到 40 个字符': 'The name must be 2 to 40 characters.',
  '入学年份无效': 'That enrollment year is not valid.',
  '申请已提交，请等待审核': 'The application is already in. Please wait for a decision.',
  '该邮箱尚未通过人工审核': 'This email has not been approved yet.',
  '校友荣誉顾问请使用学校邮箱自行注册': 'Alumni honorary advisors register themselves with a university email.',
  '校友荣誉顾问请先用学校邮箱注册，再在成员身份里指定': 'Alumni honorary advisors register with a university email first, then an administrator assigns the role.',
  '翻译服务暂时不可用，请稍后再试': 'Translation is unavailable right now. Try again in a moment.',
  '这段内容较长，暂时只能翻译较短的文字': 'This is too long to translate. Try a shorter message.',
  '操作过于频繁，请稍后再试': 'Too many attempts. Try again in a moment.',
  '尝试次数过多，请重新获取验证码': 'Too many attempts. Request a new code.',
  '没有权限执行此操作': 'You do not have permission to do that.',
  '未找到': 'That could not be found.',
  '服务器出错，请稍后再试': 'Something went wrong. Try again in a moment.',
  '先加好友才能私聊': 'Add each other as friends before sending a direct message.',
  '不能和自己私聊': 'You cannot message yourself.',
  '此频道不允许你发言': 'You cannot post in this channel.',
  '频道不存在': 'That channel does not exist.',
  '网络连接失败，请检查网络后重试': 'The network request failed. Check your connection and try again.',
  '出错了，请稍后再试': 'Something went wrong. Try again in a moment.',
};

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function inLocale(message: string): string {
  if (useLocaleStore.getState().locale !== 'en') return message;
  return ENGLISH[message] ?? message;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError) return inLocale(error.message);
  if (error instanceof TypeError) return inLocale('网络连接失败，请检查网络后重试');
  return inLocale('出错了，请稍后再试');
}
