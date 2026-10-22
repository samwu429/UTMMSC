import { MENTIONS_MAX, MESSAGE_TEXT_MAX } from '@utmmsc/shared';

/**
 * Pure text editing for the composer. A mention is the token '@' + name + U+2005 (a four-per-em space),
 * as in WeChat. The closing U+2005 marks where a token ends, so Backspace can remove it whole and the send
 * path can tell which mentions are still in the text.
 * 输入框的纯文字编辑逻辑。提醒标记与微信一致，为 '@' + 名字 + U+2005（四分之一全角空格）。结尾的 U+2005
 * 标出标记的边界，退格可以整体删除，发送时也能判断哪些提醒仍在文字里。
 */

export const MENTION_END = String.fromCharCode(0x2005);
/** Typing either the ASCII or the full-width at sign opens the picker. */
/** 输入半角或全角 @ 都会打开选择列表。 */
const TRIGGERS: readonly string[] = ['@', String.fromCharCode(0xff20)];
const LABEL_MAX = 64;
/** A token typed or pasted without a tracked member: no spaces and no second at sign inside. */
/** 没有对应成员记录的标记（手动输入或粘贴）：中间不含空白，也不含第二个 @。 */
const LOOSE_TOKEN = new RegExp(`@[^@\\s]{1,${LABEL_MAX}}${MENTION_END}$`);
/** Longest grapheme cluster looked at when deleting backwards, in UTF-16 code units. */
/** 向后删除时检查的最长字素簇，单位为 UTF-16 码元。 */
const GRAPHEME_TAIL = 64;

export type MentionTarget = { kind: 'member'; id: string; label: string } | { kind: 'all'; label: string };

export interface TextSelection {
  start: number;
  end: number;
}

export interface TextEdit {
  text: string;
  caret: number;
}

function clampSelection(text: string, selection: TextSelection): TextSelection {
  const low = Math.min(selection.start, selection.end);
  const high = Math.max(selection.start, selection.end);
  return { start: Math.max(0, Math.min(low, text.length)), end: Math.max(0, Math.min(high, text.length)) };
}

/** Caps text at MESSAGE_TEXT_MAX without leaving half of a surrogate pair at the cut. */
/** 把文字截到 MESSAGE_TEXT_MAX，且不会在截断处留下半个代理对。 */
export function capMessageText(text: string, max: number = MESSAGE_TEXT_MAX): string {
  if (text.length <= max) return text;
  const lastCode = text.charCodeAt(max - 1);
  return text.slice(0, lastCode >= 0xd800 && lastCode <= 0xdbff ? max - 1 : max);
}

/** Display name as it appears inside a token: whitespace collapsed, so the closing U+2005 stays unique. */
/** 名字在标记中的写法：空白合并为一个空格，保证结尾的 U+2005 唯一。 */
export function mentionLabel(name: string): string {
  return Array.from(name.replace(/\s+/g, ' ').trim()).slice(0, LABEL_MAX).join('');
}

export function mentionToken(label: string): string {
  return `@${label}${MENTION_END}`;
}

/** Replaces the selection with `insert`. Null when the result would pass the message limit. */
/** 用 `insert` 替换选区。结果超过消息长度上限时返回 null。 */
export function insertAtSelection(text: string, selection: TextSelection, insert: string, max: number = MESSAGE_TEXT_MAX): TextEdit | null {
  const { start, end } = clampSelection(text, selection);
  const next = text.slice(0, start) + insert + text.slice(end);
  if (next.length > max) return null;
  return { text: next, caret: start + insert.length };
}

/**
 * Inserts a mention token at the selection. With `replaceTrigger`, the '@' typed just before the caret
 * becomes the start of the token instead of staying as a second at sign.
 * 在选区处插入提醒标记。设置 `replaceTrigger` 时，光标前刚输入的 '@' 会成为标记的开头，而不是多出一个 @。
 */
export function insertMention(text: string, selection: TextSelection, target: MentionTarget, options: { replaceTrigger?: boolean } = {}): TextEdit | null {
  if (!target.label) return null;
  const range = clampSelection(text, selection);
  const before = text[range.start - 1];
  const start = options.replaceTrigger && before !== undefined && TRIGGERS.includes(before) ? range.start - 1 : range.start;
  return insertAtSelection(text, { start, end: range.end }, mentionToken(target.label));
}

/** True when `next` is `prev` with a single at sign typed right before the caret. */
/** 当 `next` 恰好是在 `prev` 的光标前输入了一个 @ 时为 true。 */
export function typedMentionTrigger(prev: string, next: string, caret: number): boolean {
  if (next.length !== prev.length + 1 || caret < 1 || caret > next.length) return false;
  const typed = next[caret - 1];
  if (typed === undefined || !TRIGGERS.includes(typed)) return false;
  return next.slice(0, caret - 1) + next.slice(caret) === prev;
}

/** Length of the mention token that ends exactly at `caret`, or 0. Tracked names win over the loose pattern. */
/** 恰好在 `caret` 处结束的提醒标记长度，没有则为 0。已记录的名字优先于宽松匹配。 */
function tokenLengthBefore(text: string, caret: number, mentions: readonly MentionTarget[]): number {
  if (caret < 2 || text[caret - 1] !== MENTION_END) return 0;
  const before = text.slice(0, caret);
  let best = 0;
  for (const mention of mentions) {
    const token = mentionToken(mention.label);
    if (token.length > best && before.endsWith(token)) best = token.length;
  }
  if (best) return best;
  const match = LOOSE_TOKEN.exec(before.slice(-(LABEL_MAX + 2)));
  return match ? match[0].length : 0;
}

/** Backspace right after a token removes the whole token. Null when the caret is anywhere else. */
/** 紧跟在标记之后按退格会删除整个标记。光标在其他位置时返回 null。 */
export function removeTokenOnBackspace(text: string, selection: TextSelection, mentions: readonly MentionTarget[]): TextEdit | null {
  const { start, end } = clampSelection(text, selection);
  if (start !== end) return null;
  const length = tokenLengthBefore(text, start, mentions);
  if (!length) return null;
  return { text: text.slice(0, start - length) + text.slice(start), caret: start - length };
}

/**
 * Some keyboards delete without a cancelable event. When the only change from `prev` is a removed U+2005
 * that closed a token, this removes the rest of that token too. `caret` is the caret after the deletion.
 * 有些键盘删除时不会发出可取消的事件。如果相对 `prev` 唯一的变化是删掉了结束标记的 U+2005，则把该标记的其余部分一并删除。
 * `caret` 为删除之后的光标位置。
 */
export function repairBrokenToken(prev: string, next: string, caret: number, mentions: readonly MentionTarget[]): TextEdit | null {
  if (next.length !== prev.length - 1 || caret < 0 || caret > next.length) return null;
  if (prev[caret] !== MENTION_END) return null;
  if (prev.slice(0, caret) + prev.slice(caret + 1) !== next) return null;
  return removeTokenOnBackspace(prev, { start: caret + 1, end: caret + 1 }, mentions);
}

function lastGraphemeLength(before: string): number {
  if (!before) return 0;
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    let last = '';
    for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(before.slice(-GRAPHEME_TAIL))) last = segment;
    if (last) return last.length;
  }
  const code = before.charCodeAt(before.length - 1);
  return code >= 0xdc00 && code <= 0xdfff && before.length > 1 ? 2 : 1;
}

/**
 * The emoji panel's delete key: removes the selection, else a whole mention token, else one grapheme
 * (so an emoji built from several code points goes in one press).
 * 表情面板的删除键：有选区时删除选区，否则删除整个提醒标记，再否则删除一个字素（由多个码点组成的表情也一次删除）。
 */
export function deleteBackward(text: string, selection: TextSelection, mentions: readonly MentionTarget[]): TextEdit {
  const { start, end } = clampSelection(text, selection);
  if (start !== end) return { text: text.slice(0, start) + text.slice(end), caret: start };
  const token = removeTokenOnBackspace(text, { start, end }, mentions);
  if (token) return token;
  const length = lastGraphemeLength(text.slice(0, start));
  return { text: text.slice(0, start - length) + text.slice(start), caret: start - length };
}

function countOccurrences(text: string, token: string): number {
  let count = 0;
  for (let index = text.indexOf(token); index !== -1; index = text.indexOf(token, index + token.length)) count += 1;
  return count;
}

/**
 * Tracked mentions whose token is still in the text. Two members with the same name share one token,
 * so each occurrence keeps only one of them, earliest first.
 * 文字中仍保留标记的已记录提醒。同名成员的标记相同，每出现一次只保留其中一人，按插入先后。
 */
export function presentMentions(text: string, mentions: readonly MentionTarget[]): MentionTarget[] {
  const left = new Map<string, number>();
  const present: MentionTarget[] = [];
  for (const mention of mentions) {
    const token = mentionToken(mention.label);
    const remaining = left.get(token) ?? countOccurrences(text, token);
    if (remaining <= 0) {
      left.set(token, 0);
      continue;
    }
    left.set(token, remaining - 1);
    present.push(mention);
  }
  return present;
}

/**
 * Mention ids and the everyone flag for the tokens still present at send time. Ids are deduped and capped
 * at MENTIONS_MAX, because the server rejects a longer list; everyone counts only when `allowAll` is set.
 * 发送时仍在文字中的提醒 id 与“所有人”标记。id 去重并限制在 MENTIONS_MAX 以内，因为服务端会拒绝更长的列表；
 * 只有 `allowAll` 为 true 时才计入“所有人”。
 */
export function collectMentions(text: string, mentions: readonly MentionTarget[], options: { allowAll: boolean }): { mentions: string[]; mentionAll: boolean } {
  const ids: string[] = [];
  let mentionAll = false;
  for (const mention of presentMentions(text, mentions)) {
    if (mention.kind === 'all') {
      if (options.allowAll) mentionAll = true;
    } else if (!ids.includes(mention.id)) {
      ids.push(mention.id);
    }
  }
  return { mentions: ids.slice(0, MENTIONS_MAX), mentionAll };
}
