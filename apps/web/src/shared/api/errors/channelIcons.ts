/**
 * English for the channel routes' messages (/channels, the icon routes /channels/:id/icon included) and the icon
 * editor.
 * Owner: A-sections, admin channels, events, announcements and icon editing. shared/api/errors.ts merges this file
 * and is otherwise frozen.
 * 频道接口（/channels，包括图标接口 /channels/:id/icon）和图标编辑器提示的英文。
 * 维护者：A-sections，管理后台的频道、活动、公告与图标编辑。shared/api/errors.ts 合并本文件，此外不再改动。
 */
import type { EnglishPattern } from '../errors';

/** Exact server text to its English. The first six are CHANNEL_ICON_MESSAGES of the channel routes. */
/** 服务端原文到英文的对照。前六条是频道接口的 CHANNEL_ICON_MESSAGES。 */
export const ENGLISH: Readonly<Record<string, string>> = {
  '图标只支持 WebP 或 JPEG': 'Icons must be WebP or JPEG.',
  '图标尺寸不对，请重新选择': 'The icon is the wrong size. Choose it again.',
  '图标不能超过 256KB': 'The icon must be 256 KB or smaller.',
  '没有这个预设图标': "That preset icon doesn't exist.",
  '频道图标暂不可用': "Channel icons aren't available yet.",
  '图标刚被别人修改，请重试': 'Someone else just changed the icon. Try again.',
  '成员列表格式错误': "The member list isn't valid.",
  '成员过多': 'Too many members were picked for one channel.',
};

/** The channel routes' field names, for the generic checks that embed them. */
/** 频道接口的字段名，用于包含字段名的通用检查提示。 */
const FIELDS: Readonly<Record<string, string>> = {
  '频道名称': 'channel name',
  '频道简介': 'channel description',
  '受众': 'audience',
  '发言规则': 'posting rule',
  '历史消息': 'history setting',
  '图标': 'icon',
  '缩略图': 'thumbnail',
};

function field(name: string | undefined): string {
  return name !== undefined && Object.prototype.hasOwnProperty.call(FIELDS, name) ? (FIELDS[name] ?? 'field') : 'field';
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Server text that embeds a field name. Only the channel field names match; others fall through to the next map. */
/** 含字段名的服务端提示。只匹配频道接口的字段名；其他的交给后面的对照处理。 */
export const ENGLISH_PATTERNS: readonly EnglishPattern[] = [
  [/^缺少 (频道名称|图标|缩略图)$/, (m) => `${capitalized(field(m[1]))} is missing.`],
  [/^(频道名称|频道简介) 过长$/, (m) => `The ${field(m[1])} is too long.`],
  [/^(频道简介) 格式错误$/, (m) => `The ${field(m[1])} isn't valid.`],
  [/^(受众|发言规则|历史消息) 取值无效$/, (m) => `That ${field(m[1])} isn't valid.`],
];
