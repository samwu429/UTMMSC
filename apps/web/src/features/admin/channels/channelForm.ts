import {
  CHANNEL_AUDIENCES,
  CHANNEL_AUDIENCE_LABELS,
  CHANNEL_AUDIENCE_LABELS_EN,
  DEFAULT_HISTORY_VISIBILITY,
  POST_POLICIES,
  POST_POLICY_LABELS,
  POST_POLICY_LABELS_EN,
  type AdminChannelRow,
  type ChannelAudience,
  type CreateChannelBody,
  type HistoryVisibility,
  type PostPolicy,
  type UpdateChannelBody,
} from '@utmmsc/shared';
import { sectionPath, type Phrase } from '../sections';

/**
 * 频道 without the screens: filters, search and order of the list, the addresses of each screen, what a PATCH sends
 * (only what changed) and which changes take access away, so they are confirmed. The server checks every change
 * again; these rules only decide what the screens offer and ask. Pure, so it is tested without a browser.
 * 不含界面的「频道」：列表的筛选、搜索和排序，各界面的地址，PATCH 发送的内容（只发改动的字段），以及哪些改动会让人失去访问权限、因此需要确认。
 * 服务器会再次检查每一项修改；这些规则只决定界面提供什么、询问什么。纯函数，无需浏览器即可测试。
 */

export const CHANNEL_NAME_MAX = 40;
export const CHANNEL_DESCRIPTION_MAX = 200;

export const CHANNEL_FILTERS = ['all', 'role', 'custom'] as const;
export type ChannelFilter = (typeof CHANNEL_FILTERS)[number];

export const CHANNEL_FILTER_LABELS: Record<ChannelFilter, Phrase> = {
  all: { zh: '全部', en: 'All' },
  role: { zh: '按身份开放', en: 'By role' },
  custom: { zh: '指定成员', en: 'Selected members' },
};

/** The screens under a channel: /admin/channels/:id/<screen>. */
/** 频道之下的界面：/admin/channels/:id/<界面>。 */
export const CHANNEL_SCREENS = ['name', 'description', 'audience', 'post', 'members'] as const;
export type ChannelScreen = (typeof CHANNEL_SCREENS)[number];

/** /admin/channels/new is the create form, so no channel id can be "new". */
/** /admin/channels/new 是新建表单，因此没有频道的 id 能是「new」。 */
export const NEW_CHANNEL = 'new';

export function isChannelScreen(value: string | undefined): value is ChannelScreen {
  return CHANNEL_SCREENS.some((screen) => screen === value);
}

export function readChannelFilter(raw: string | null): ChannelFilter {
  return CHANNEL_FILTERS.find((filter) => filter === raw) ?? 'all';
}

/** The list, a channel, or one of its screens, keeping the list's query (?q=, ?f=). */
/** 列表、某个频道或其下的某个界面，并保留列表的查询参数（?q=、?f=）。 */
export function channelsPath(id?: string | null, screen?: ChannelScreen | null, search = ''): string {
  const base = sectionPath('channels');
  if (!id) return `${base}${search}`;
  const item = `${base}/${encodeURIComponent(id)}`;
  return `${screen ? `${item}/${screen}` : item}${search}`;
}

export function newChannelPath(search = ''): string {
  return `${sectionPath('channels')}/${NEW_CHANNEL}${search}`;
}

export function audienceLabel(audience: ChannelAudience): Phrase {
  return { zh: CHANNEL_AUDIENCE_LABELS[audience], en: CHANNEL_AUDIENCE_LABELS_EN[audience] };
}

export function postPolicyLabel(policy: PostPolicy): Phrase {
  return { zh: POST_POLICY_LABELS[policy], en: POST_POLICY_LABELS_EN[policy] };
}

/** One line under each audience on the 谁能看到 screen. */
/** 「谁能看到」界面中每种受众下方的一行说明。 */
export const AUDIENCE_DETAILS: Record<ChannelAudience, Phrase> = {
  all: { zh: '所有在用成员', en: 'Every active member' },
  student: { zh: '在读状态为在校生的成员', en: 'Members whose status is student' },
  alumni: { zh: '在读状态为毕业生的成员', en: 'Members whose status is graduate' },
  honorary: { zh: '校友和校外荣誉顾问', en: 'Alumni and external honorary advisors' },
  heads: { zh: '各部门部长', en: 'The head of each department' },
  officers: { zh: '主席、秘书长和副主席', en: 'The president, secretary-general and vice presidents' },
  staff: { zh: '部长和主席团', en: 'Department heads and the presidium' },
  custom: { zh: '只有你选的人', en: 'Only the people you pick' },
};

/** One line under each post policy on the 谁能发言 screen. */
/** 「谁能发言」界面中每种发言规则下方的一行说明。 */
export const POST_POLICY_DETAILS: Record<PostPolicy, Phrase> = {
  members: { zh: '能看到频道的人都可以发消息', en: 'Everyone who can see the channel can send messages' },
  staff: { zh: '其他人只能看，适合通知类频道', en: 'Everyone else can only read, as in an announcements channel' },
};

export function matchesChannelFilter(channel: AdminChannelRow, filter: ChannelFilter): boolean {
  if (filter === 'all') return true;
  return filter === 'custom' ? channel.audience === 'custom' : channel.audience !== 'custom';
}

export function channelFilterCounts(channels: readonly AdminChannelRow[]): Record<ChannelFilter, number> {
  const counts = Object.fromEntries(CHANNEL_FILTERS.map((filter) => [filter, 0])) as Record<ChannelFilter, number>;
  for (const channel of channels) {
    for (const filter of CHANNEL_FILTERS) if (matchesChannelFilter(channel, filter)) counts[filter] += 1;
  }
  return counts;
}

/** Lowercased text the search runs against: name, description and both names of the audience. */
/** 搜索所依据的小写文字：名称、简介以及受众的两种名称。 */
export function channelSearchText(channel: AdminChannelRow): string {
  const audience = audienceLabel(channel.audience);
  return [channel.name, channel.description ?? '', audience.zh, audience.en].join('\n').toLocaleLowerCase();
}

/** Every word of the query must appear; an empty query matches everything. */
/** 查询中的每个词都必须出现；空查询匹配所有内容。 */
export function matchesChannelQuery(text: string, query: string): boolean {
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return words.every((word) => text.includes(word));
}

function time(iso: string | null | undefined): number {
  const ms = iso ? Date.parse(iso) : Number.NaN;
  return Number.isNaN(ms) ? -Infinity : ms;
}

/**
 * Most recent activity first: the last message, or the creation of a channel with none yet. Ties by name, then id,
 * so the order never jumps between loads.
 * 最近活动在前：最后一条消息的时间；还没有消息的频道按创建时间。相同时按名称、再按 id 排序，因此每次加载的顺序都不会跳动。
 */
export function sortChannels(channels: readonly AdminChannelRow[], locale: 'zh' | 'en' = 'zh'): AdminChannelRow[] {
  const collator = new Intl.Collator(locale === 'en' ? 'en' : 'zh-Hans-CN', { sensitivity: 'base', numeric: true });
  return [...channels].sort(
    (a, b) =>
      time(b.lastMessageAt ?? b.createdAt) - time(a.lastMessageAt ?? a.createdAt) ||
      collator.compare(a.name, b.name) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/** What the settings screens edit, one field at a time. */
/** 设置界面逐项编辑的内容。 */
export interface ChannelDraft {
  name: string;
  description: string;
  audience: ChannelAudience;
  postPolicy: PostPolicy;
  memberIds: readonly string[];
  historyVisibility: HistoryVisibility;
}

export function emptyChannelDraft(): ChannelDraft {
  return { name: '', description: '', audience: 'all', postPolicy: 'members', memberIds: [], historyVisibility: DEFAULT_HISTORY_VISIBILITY };
}

export function draftOf(channel: AdminChannelRow): ChannelDraft {
  return {
    name: channel.name,
    description: channel.description ?? '',
    audience: channel.audience,
    postPolicy: channel.postPolicy,
    memberIds: [...channel.memberIds],
    historyVisibility: channel.historyVisibility ?? DEFAULT_HISTORY_VISIBILITY,
  };
}

function sameMembers(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size !== right.size) return false;
  for (const id of left) if (!right.has(id)) return false;
  return true;
}

/**
 * The PATCH body for the fields in `change` that really differ from the channel: nothing else is sent, so re-saving a
 * value does nothing on the server (re-sending since_join would otherwise not matter, but other fields revoke room
 * tickets). Names and descriptions are compared trimmed; an empty description is sent as null. The member list is a
 * full list, sent only for a channel that is or becomes custom and only when the set changed. Empty when nothing
 * changed.
 * `change` 中与频道确实不同的字段组成的 PATCH 请求体：不发送其他字段，因此重新保存同一个值在服务器上不起作用（其他字段会让房间票据失效）。
 * 名称和简介去掉首尾空格后比较；空简介以 null 发送。成员列表是完整列表，只对已是或将成为指定成员的频道、且成员集合有变化时发送。
 * 没有改动时为空对象。
 */
export function channelPatch(channel: AdminChannelRow, change: Partial<ChannelDraft>): UpdateChannelBody {
  const patch: UpdateChannelBody = {};
  if (change.name !== undefined && change.name.trim() !== channel.name) patch.name = change.name.trim();
  if (change.description !== undefined) {
    const next = change.description.trim() || null;
    if (next !== (channel.description?.trim() || null)) patch.description = next;
  }
  if (change.audience !== undefined && change.audience !== channel.audience) patch.audience = change.audience;
  if (change.postPolicy !== undefined && change.postPolicy !== channel.postPolicy) patch.postPolicy = change.postPolicy;
  if (change.historyVisibility !== undefined && change.historyVisibility !== (channel.historyVisibility ?? DEFAULT_HISTORY_VISIBILITY)) {
    patch.historyVisibility = change.historyVisibility;
  }
  const audience = change.audience ?? channel.audience;
  if (change.memberIds !== undefined && audience === 'custom' && !sameMembers(change.memberIds, channel.memberIds)) {
    patch.memberIds = [...new Set(change.memberIds)];
  }
  return patch;
}

export function isEmptyPatch(patch: UpdateChannelBody): boolean {
  return Object.keys(patch).length === 0;
}

/** The POST /channels body for the create form. */
/** 新建表单对应的 POST /channels 请求体。 */
export function createChannelBody(draft: ChannelDraft): CreateChannelBody {
  const body: CreateChannelBody = {
    name: draft.name.trim(),
    audience: draft.audience,
    postPolicy: draft.postPolicy,
    historyVisibility: draft.historyVisibility,
  };
  const description = draft.description.trim();
  if (description) body.description = description;
  if (draft.audience === 'custom' && draft.memberIds.length > 0) body.memberIds = [...new Set(draft.memberIds)];
  return body;
}

/** Whether a name can be saved: something besides spaces, at most 40 characters. */
/** 名称能否保存：除空格外还有内容，且不超过 40 个字符。 */
export function isValidChannelName(name: string): boolean {
  return name.trim().length > 0 && name.length <= CHANNEL_NAME_MAX;
}

/**
 * Who sees each implicit audience, as nested groups: every audience is inside 全体成员, and 部门部长 and 主席团 are
 * inside 负责人及以上. Moving from an audience to one that holds it widens access; any other move narrows it.
 * 各隐式受众包含的人群，按嵌套关系：每种受众都在「全体成员」之内，「部门部长」和「主席团」在「负责人及以上」之内。从某个受众改为包含它的受众
 * 是放宽访问；其他任何改动都是收窄。
 */
const CONTAINS: Partial<Record<ChannelAudience, readonly ChannelAudience[]>> = {
  all: CHANNEL_AUDIENCES.filter((audience) => audience !== 'all'),
  staff: ['heads', 'officers'],
};

/**
 * True when moving the channel from `from` to `to` can take it away from someone who sees it now, so the change is
 * confirmed. A custom channel's members may sit outside any group, so only 全体成员 is safe from it.
 * 把频道从 `from` 改为 `to` 可能让现在能看到它的人失去访问权限时为 true，此时需要确认。指定成员频道中的成员可能不属于任何分组，因此从它出发
 * 只有改为「全体成员」才是安全的。
 */
export function isNarrowing(from: ChannelAudience, to: ChannelAudience): boolean {
  if (from === to) return false;
  return !(CONTAINS[to] ?? []).includes(from);
}

/** Members in `before` and not in `after`: they lose access when the list is saved. */
/** 在 `before` 中而不在 `after` 中的成员：保存名单后他们会失去访问权限。 */
export function removedMembers(before: readonly string[], after: readonly string[]): string[] {
  const keep = new Set(after);
  return [...new Set(before)].filter((id) => !keep.has(id));
}

export function addedMembers(before: readonly string[], after: readonly string[]): string[] {
  const had = new Set(before);
  return [...new Set(after)].filter((id) => !had.has(id));
}

/**
 * What a choice on 谁能看到 does. 指定成员 for a channel that is not custom yet saves nothing there: it opens the member
 * picker, whose 完成 sends the audience and the list in one PATCH. The server then keeps the join times of the people
 * who could already read the channel instead of inviting them again from that moment, and leaving the picker changes
 * nothing. Two requests would also lock everyone else out between them. Every other choice saves at once.
 * 「谁能看到」中某个选择的效果。尚不是指定成员的频道选择「指定成员」时，这里不保存，而是打开成员选择，由其「完成」在一次 PATCH 中同时发送受众和名单。
 * 服务器因此保留原本能看到频道的人的加入时间，而不是把他们当作此刻新邀请的成员；中途离开成员选择也不会改动频道。分两次请求还会在两次之间让其他人都看不到频道。
 * 其他选择立即保存。
 */
export function audienceChoice(channel: Pick<AdminChannelRow, 'audience'>, next: ChannelAudience): 'members' | 'save' {
  return next === 'custom' && channel.audience !== 'custom' ? 'members' : 'save';
}

/** What 完成 on the member picker saves, and what it asks first. */
/** 成员选择的「完成」保存什么，以及先询问什么。 */
export interface MemberPickerSave {
  change: Partial<ChannelDraft>;
  /** narrow: the channel becomes custom; remove: people are taken out of the list. */
  /** narrow：频道改为指定成员；remove：有人被移出名单。 */
  ask: 'narrow' | 'remove' | null;
  removed: number;
}

/**
 * 完成 on the member picker. A channel that is not custom yet becomes custom together with the list, in one request,
 * after the narrowing question; a custom channel saves only its list, asking first when people are taken out.
 * 成员选择的「完成」。尚不是指定成员的频道在确认收窄之后，于同一次请求中改为指定成员并保存名单；已是指定成员的频道只保存名单，有人被移出时先询问。
 */
export function memberPickerSave(channel: Pick<AdminChannelRow, 'audience' | 'memberIds'>, after: readonly string[]): MemberPickerSave {
  if (channel.audience !== 'custom') {
    return { change: { audience: 'custom', memberIds: [...after] }, ask: isNarrowing(channel.audience, 'custom') ? 'narrow' : null, removed: 0 };
  }
  const removed = removedMembers(channel.memberIds, after).length;
  return { change: { memberIds: [...after] }, ask: removed > 0 ? 'remove' : null, removed };
}

/** The order the 谁能看到 screen lists the audiences: everyone, then the enrollment groups, the offices, and custom. */
/** 「谁能看到」界面列出受众的顺序：全体，然后是在读分组、职位分组，最后是指定成员。 */
export const AUDIENCE_ORDER: readonly ChannelAudience[] = ['all', 'student', 'alumni', 'honorary', 'heads', 'officers', 'staff', 'custom'];
export const POST_POLICY_ORDER: readonly PostPolicy[] = POST_POLICIES;
