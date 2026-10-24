import { PROGRAM_EN, useLocaleStore } from '../i18n/locale';

const ENGLISH: Record<string, string> = {
  ...PROGRAM_EN,
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
  '入学已满五年，只能是毕业生': 'This member enrolled five or more years ago, so they can only be an alumnus.',
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
  '你不在这个频道里': 'You are not in this channel.',
  '房间不存在': 'That room does not exist.',
  '会话不存在': 'That conversation does not exist.',
  '你不在这个会话里': 'You are not in this conversation.',
  '成员不存在': 'That member does not exist.',
  '票据无效或已过期': 'The connection ticket expired. Reconnecting.',
  '媒体链接已过期': 'This media link has expired.',
  '文件不存在': 'That file does not exist.',
  '只能删除自己上传的文件': 'You can only delete files you uploaded.',
  '接口不存在': 'That could not be found.',
  '请求格式错误': 'The request was not valid.',
  '路径格式错误': 'The request was not valid.',
  '申请不存在或已处理': 'That request does not exist or was already handled.',
  '这个职位已经有人担任': 'Someone already holds this office.',
  '这个职位已经有人担任，请先给他换一个身份': 'Someone else now holds this office. Give this member a different role first.',
  '荣誉顾问只能是毕业生': 'Honorary advisors are always graduates.',
  '测试身份下不能修改自己的在读状态': 'You cannot change your own enrollment status while using a test role.',
  '已经是毕业生': 'You are already recorded as a graduate.',
  '成员列表里有不存在的成员': 'The member list includes someone who does not exist.',
  '图片不能超过 8MB': 'Images must be 8MB or smaller.',
  '文件不能超过 25MB': 'Files must be 25MB or smaller.',
  '只支持 JPEG、PNG、WebP、GIF': 'Only JPEG, PNG, WebP, and GIF images are supported.',
  '发送太快，请稍候': 'You are sending too fast. Wait a moment.',
  '你已被禁言': 'You have been muted.',
  '消息不能为空': 'The message is empty.',
  '消息格式错误': 'The message was not valid.',
  '消息过大': 'The message is too large.',
  '图片无效': 'That image is not valid.',
  '消息不存在': 'That message no longer exists.',
  '只能删除自己的消息': 'You can only delete your own messages.',
  '只能撤回自己的消息': 'You can only recall your own messages.',
  '已超过 3 分钟，无法撤回': 'Messages can only be recalled within 3 minutes.',
  '这条消息不能撤回': 'This message cannot be recalled.',
  '没有禁言权限': 'You do not have permission to mute members.',
  '不能禁言这位成员': 'You cannot mute this member.',
  '私聊中不能禁言': 'No one can be muted in a direct chat.',
  '不能删除这位成员的消息': 'You cannot remove messages from this member.',
  '消息最多 2000 字': 'Messages can be at most 2000 characters.',
  '引用的消息不存在': 'The quoted message is no longer available.',
  '只有管理员可以@所有人': 'Only moderators can mention everyone.',
  '这条消息不能删除': 'This message cannot be deleted.',
  '查询过于频繁，请稍候': 'Loading too quickly. Wait a moment.',
  '图片尺寸无效': 'The image size is not valid.',
  '开始时间无效': 'That start time is not valid.',
  '通知服务尚未开通': 'Notifications are not set up on the server yet.',
  '设备信息格式错误': 'The device details were not valid.',
  '新消息通知 格式错误': 'The new message setting was not valid.',
  '活动通知 格式错误': 'The event notification setting was not valid.',
  '通知显示消息内容 格式错误': 'The message preview setting was not valid.',
  '通知设置格式错误': 'The notification options were not valid.',
  '自定义通知时间最多 5 个': 'You can add at most 5 custom notification times.',
  '通知时间无效': 'That notification time is not valid.',
  '通知时间必须晚于现在': 'Notification times must be in the future.',
  '通知时间不能晚于活动开始后一天': 'Notification times can be at most one day after the event starts.',
  '好友动态互动通知 格式错误': 'The friend update activity setting was not valid.',
  // 好友动态: refusals of the /moments routes, their input checks, and the media upload they use.
  // 好友动态：/moments 接口、其输入检查以及所用媒体上传的拒绝提示。
  '这条动态已删除或无法查看': "This update was deleted or isn't available.",
  '这条评论已删除或无法查看': "This comment was deleted or isn't available.",
  '无法回复这条评论': "You can't reply to this comment.",
  '评论不能为空': 'Write something first.',
  '请选择谁可以看': 'Choose who can see this.',
  '分页参数无效': 'The page link is not valid.',
  '这条内容已经发过了': 'This was already sent.',
  '这条动态已被管理员移除': 'An admin removed this update.',
  '今天发得太多了，明天再来吧': "That's a lot for one day. Try again tomorrow.",
  '不能处理职位不低于你的成员的内容': "You can't act on content from someone at or above your level.",
  '不能投诉自己的内容': "You can't report your own content.",
  '这条投诉不存在': "This report doesn't exist.",
  '投诉状态无效': 'That report status is not valid.',
  '不能对自己设置动态权限': "You can't set update privacy for yourself.",
  '好友动态正在升级，请稍后再试': 'Friend updates are being upgraded. Try again soon.',
  '写点什么，或加上照片、视频': 'Write something, or add photos or a video.',
  '照片或视频的格式不对': "The photos or video aren't in a format that can be posted.",
  '照片或视频的尺寸不对': "The size of a photo or video isn't valid.",
  '预览图无法使用，请重新选择': "A preview can't be used. Choose the file again.",
  '请选择要修改的设置': 'Choose a setting to change.',
  '请选择投诉原因': 'Choose a reason for the report.',
  '请填写移除原因': 'Give a reason for the removal.',
  '请选择处理方式': 'Choose how to handle the report.',
  '时间格式错误': "That time isn't valid.",
  '有照片或视频无法使用，请重新选择': "A photo or video can't be used. Choose it again.",
  '一条动态只能有一个视频': 'A post can have only one video.',
  '照片和视频不能发在同一条里': "Photos and a video can't share one post.",
  '只支持 JPEG、PNG、WebP、GIF 照片，或 MP4、MOV、WebM 视频': 'Only JPEG, PNG, WebP, and GIF photos, or MP4, MOV, and WebM videos, are supported.',
  '照片不能超过 8MB': 'Photos must be 8MB or smaller.',
  '视频不能超过 25MB': 'Videos must be 25MB or smaller.',
  '文件为空': 'The file is empty.',
};

/** Patterns for server messages that embed a number or a field name. */
/** 含数字或字段名的服务端消息。 */
const ENGLISH_PATTERNS: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^你已被禁言 (\d+) 分钟$/, (m) => `You have been muted for ${m[1]} minutes.`],
  [/^自定义通知时间最多 (\d+) 个$/, (m) => `You can add at most ${m[1]} custom notification times.`],
  [/^请求失败（(\d+)）$/, (m) => `The request failed (${m[1]}).`],
  [/^正文不能超过 (\d+) 字$/, (m) => `Posts can be ${m[1]} characters at most.`],
  [/^评论不能超过 (\d+) 字$/, (m) => `Comments can be ${m[1]} characters at most.`],
  [/^位置不能超过 (\d+) 字$/, (m) => `Locations can be ${m[1]} characters at most.`],
  [/^补充说明不能超过 (\d+) 字$/, (m) => `Notes can be ${m[1]} characters at most.`],
  [/^原因不能超过 (\d+) 字$/, (m) => `Reasons can be ${m[1]} characters at most.`],
  [/^最多 (\d+) 张照片$/, (m) => `A post can have at most ${m[1]} photos.`],
  [/^缺少 (.+)$/, () => 'A required field is missing.'],
  [/^(.+) 过长$/, () => 'A field is too long.'],
  [/^(.+) 格式错误$/, () => 'A field is not valid.'],
];

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
  const exact = ENGLISH[message];
  if (exact) return exact;
  for (const [pattern, render] of ENGLISH_PATTERNS) {
    const match = message.match(pattern);
    if (match) return render(match);
  }
  return message;
}

/** Translates a message that arrived outside an HTTP error, such as a socket error frame. */
/** 翻译不经 HTTP 错误到达的消息，例如连接上的错误帧。 */
export function localizedMessage(message: string): string {
  return inLocale(message);
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError) return inLocale(error.message);
  if (error instanceof TypeError) return inLocale('网络连接失败，请检查网络后重试');
  return inLocale('出错了，请稍后再试');
}
