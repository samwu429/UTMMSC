import type { SystemEvent, SystemMemberRef } from '@utmmsc/shared';

/**
 * Chat tip wording shared by the timeline and the conversation list. Pure: callers pass tr from useTr.
 * 时间线和会话列表共用的聊天提示文案。纯函数：调用方传入 useTr 得到的 tr。
 */
export type Translate = (zh: string, en: string) => string;

/** Names listed before a join tip falls back to 「等N人」. */
/** 入群提示最多列出的名字数，超出后改为「等N人」。 */
const JOIN_NAMES_SHOWN = 3;

function nameOf(name: string | null | undefined, tr: Translate): string {
  return name?.trim() || tr('成员', 'Member');
}

function quoted(name: string | null | undefined, tr: Translate): string {
  return `“${nameOf(name, tr)}”`;
}

function zhList(names: string[]): string {
  return names.join('、');
}

function enList(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export function recallText({ own, name }: { own: boolean; name: string | null | undefined }, tr: Translate): string {
  if (own) return tr('你撤回了一条消息', 'You recalled a message');
  if (!name?.trim()) return tr('有人撤回了一条消息', 'Someone recalled a message');
  const who = quoted(name, tr);
  return tr(`${who} 撤回了一条消息`, `${who} recalled a message`);
}

export function moderatorDeletedText(tr: Translate): string {
  return tr('管理员删除了一条消息', 'An admin removed a message');
}

export function legacyDeletedText(tr: Translate): string {
  return tr('一条消息已被删除', 'A message was deleted');
}

/**
 * Join notice written when an admin adds members, worded for the viewer as WeChat does:
 * 「“A”邀请你加入了频道」 for the person added, 「你邀请“B”加入了频道」 for the inviter, and
 * 「“A”邀请“B”、“C”、“D”等5人加入了频道」 once more than three people joined.
 * 管理员添加成员时写入的入群提示，按观看者的身份措辞，与微信一致：被邀请者看到「“A”邀请你加入了频道」，
 * 邀请者看到「你邀请“B”加入了频道」，超过三人时显示「“A”邀请“B”、“C”、“D”等5人加入了频道」。
 */
export function joinText(event: SystemEvent, meId: string | null | undefined, tr: Translate): string {
  const includesMe = meId ? event.members.some((member) => member.id === meId) : false;
  const others = event.members.filter((member) => !meId || member.id !== meId);
  const total = others.length + Math.max(0, event.more);
  const shown = others.slice(0, JOIN_NAMES_SHOWN).map((member: SystemMemberRef) => quoted(member.displayName, tr));
  const hidden = total - shown.length;
  const actorIsMe = Boolean(meId && event.actor && event.actor.id === meId);
  const actor = event.actor ? (actorIsMe ? tr('你', 'You') : quoted(event.actor.displayName, tr)) : null;

  // Everyone but the viewer, as 「“B”、“C”」 or 「“B”、“C”、“D”等5人」. Empty when only the viewer joined.
  // 除观看者以外的成员，如「“B”、“C”」或「“B”、“C”、“D”等5人」。只有观看者加入时为空。
  let zhOthers = '';
  let enOthers = '';
  if (total > 0) {
    if (hidden > 0 && shown.length > 0) {
      zhOthers = `${zhList(shown)}等${total}人`;
      enOthers = `${shown.join(', ')} and ${hidden} ${hidden === 1 ? 'other' : 'others'}`;
    } else if (shown.length > 0) {
      zhOthers = zhList(shown);
      enOthers = enList(shown);
    } else {
      zhOthers = `${total}人`;
      enOthers = `${total} ${total === 1 ? 'person' : 'people'}`;
    }
  }

  if (actor) {
    if (includesMe) {
      if (!zhOthers) return tr(`${actor}邀请你加入了频道`, `${actor} invited you to the channel`);
      return tr(`${actor}邀请你和${zhOthers}加入了频道`, `${actor} invited you and ${enOthers} to the channel`);
    }
    if (!zhOthers) return tr('有新成员加入了频道', 'New members joined the channel');
    return tr(`${actor}邀请${zhOthers}加入了频道`, `${actor} invited ${enOthers} to the channel`);
  }
  if (includesMe) {
    if (!zhOthers) return tr('你加入了频道', 'You joined the channel');
    return tr(`你和${zhOthers}加入了频道`, `You and ${enOthers} joined the channel`);
  }
  if (!zhOthers) return tr('有新成员加入了频道', 'New members joined the channel');
  return tr(`${zhOthers}加入了频道`, `${enOthers} joined the channel`);
}

/** Tip shown above the first visible message of a member who joined after the history floor. */
/** 在历史下限之后加入的成员，其第一条可见消息上方显示的提示。 */
export function selfJoinTip(name: string | null | undefined, tr: Translate): string {
  const title = name?.trim();
  if (!title) return tr('你已加入频道', 'You joined this channel');
  return tr(`你已加入“${title}”`, `You joined “${title}”`);
}

export function imageLabel(tr: Translate): string {
  return tr('[图片]', '[Photo]');
}

/** A sticker in lists, quotes and screen-reader announcements. */
/** 表情在列表、引用和读屏播报中的显示文字。 */
export function stickerLabel(tr: Translate): string {
  return tr('[表情]', '[Sticker]');
}
