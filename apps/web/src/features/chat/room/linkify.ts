/**
 * Splits message text into plain text, web links, email addresses and phone numbers. A single
 * left-to-right scan with no backtracking keeps it linear for any input. Only http, https, mailto and
 * tel links are ever produced.
 * 把消息文字拆分为普通文字、网址、邮箱和电话号码。只做一次从左到右、不回溯的扫描，任何输入都是线性时间。
 * 只会生成 http、https、mailto 和 tel 链接。
 */

export type LinkSegment =
  | { type: 'text'; text: string }
  | { type: 'url'; text: string; href: string }
  | { type: 'email'; text: string; href: string }
  | { type: 'phone'; text: string; href: string };

interface Match {
  start: number;
  end: number;
  segment: Exclude<LinkSegment, { type: 'text' }>;
}

const PHONE_DIGITS_MIN = 7;
const PHONE_DIGITS_MAX = 15;
/** Longest unformatted digit run still read as a phone number; longer bare runs are ids or timestamps. */
/** 不带格式时仍视为电话号码的最长数字串；更长的纯数字串是编号或时间戳。 */
const PHONE_BARE_DIGITS_MAX = 12;
const HOST_MAX = 253;

/** Punctuation that ends a sentence rather than a link. */
/** 结束句子而不是链接的标点。 */
const TRAILING_PUNCTUATION = new Set(['.', ',', ':', ';', '!', '?', "'", '"', '*', '，', '。', '！', '？', '、', '；', '：', '）', '】', '」', '』', '》', '…']);
const CLOSERS: Record<string, string> = { ')': '(', ']': '[' };

function code(text: string, index: number): number {
  return index >= 0 && index < text.length ? text.charCodeAt(index) : -1;
}

function isDigit(c: number): boolean {
  return c >= 48 && c <= 57;
}

function isLetter(c: number): boolean {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}

function isAlnum(c: number): boolean {
  return isDigit(c) || isLetter(c);
}

/**
 * Printable ASCII allowed in a link. A link ends at the first space or non-ASCII character, so Chinese
 * text or punctuation typed right after it never becomes part of it.
 * 链接允许的可打印 ASCII 字符。链接在第一个空白或非 ASCII 字符处结束，紧跟其后的中文或标点不会被并入。
 */
function isUrlChar(c: number): boolean {
  if (c <= 0x20 || c >= 0x7f) return false;
  return c !== 0x3c && c !== 0x3e && c !== 0x22 && c !== 0x60 && c !== 0x7b && c !== 0x7d && c !== 0x7c && c !== 0x5c && c !== 0x5e;
}

function isLocalChar(c: number): boolean {
  return isAlnum(c) || c === 0x2e || c === 0x5f || c === 0x25 || c === 0x2b || c === 0x2d;
}

function isDomainChar(c: number): boolean {
  return isAlnum(c) || c === 0x2e || c === 0x2d;
}

function trimTrailing(candidate: string): string {
  const counts = new Map<string, number>();
  for (const c of candidate) if (c === '(' || c === ')' || c === '[' || c === ']') counts.set(c, (counts.get(c) ?? 0) + 1);
  let end = candidate.length;
  for (;;) {
    const last = candidate[end - 1];
    if (last === undefined) break;
    if (TRAILING_PUNCTUATION.has(last)) {
      end -= 1;
      continue;
    }
    const opener = CLOSERS[last];
    // Keep a closing bracket that pairs with one inside the link, as in Wikipedia addresses.
    // 保留与链接内部配对的右括号，例如维基百科的地址。
    if (opener !== undefined && (counts.get(last) ?? 0) > (counts.get(opener) ?? 0)) {
      counts.set(last, (counts.get(last) ?? 0) - 1);
      end -= 1;
      continue;
    }
    break;
  }
  return candidate.slice(0, end);
}

function validDomain(host: string, minLabels: number): boolean {
  const labels = host.split('.');
  if (labels.length < minLabels) return false;
  const tld = labels[labels.length - 1] ?? '';
  if (!/^[A-Za-z]{2,}$/.test(tld)) return false;
  return labels.every((label) => /^[A-Za-z0-9-]+$/.test(label) && !label.startsWith('-') && !label.endsWith('-'));
}

function startsWithAt(text: string, index: number, prefix: string): boolean {
  return text.slice(index, index + prefix.length).toLowerCase() === prefix;
}

function isPathStart(c: number): boolean {
  return c === 0x2f || c === 0x3f || c === 0x23;
}

function matchUrl(text: string, start: number): Match | null {
  const web = startsWithAt(text, start, 'www.');
  const scheme = startsWithAt(text, start, 'https://') ? 8 : startsWithAt(text, start, 'http://') ? 7 : 0;
  if (!web && scheme === 0) return null;
  // The host is read first and capped at the DNS length limit, so a rejected start costs a bounded
  // amount of work and the whole scan stays linear.
  // 先读取主机名，并以 DNS 长度上限封顶，被拒绝的起点只花费有限的工作量，整体扫描保持线性。
  let hostEnd = start + scheme;
  while (hostEnd < text.length && hostEnd - start - scheme <= HOST_MAX && isUrlChar(text.charCodeAt(hostEnd)) && !isPathStart(text.charCodeAt(hostEnd))) hostEnd += 1;
  if (hostEnd - start - scheme > HOST_MAX) return null;
  const host = trimTrailing(text.slice(start + scheme, hostEnd));
  if (web ? !validDomain(host.replace(/:\d{1,5}$/, ''), 3) : !/[A-Za-z0-9]/.test(host)) return null;
  let end = hostEnd;
  while (end < text.length && isUrlChar(text.charCodeAt(end))) end += 1;
  const candidate = trimTrailing(text.slice(start, end));
  const href = web ? `https://${candidate}` : candidate;
  return { start, end: start + candidate.length, segment: { type: 'url', text: candidate, href } };
}

/** `at` is the index of '@'; the local part may not reach back past `floor`. */
/** `at` 是 '@' 的位置；本地部分不能越过 `floor` 向前延伸。 */
function matchEmail(text: string, at: number, floor: number): Match | null {
  let start = at;
  while (start > floor && isLocalChar(code(text, start - 1))) start -= 1;
  while (start < at && text[start] === '.') start += 1;
  if (start === at || text[at - 1] === '.') return null;
  let end = at + 1;
  while (end < text.length && isDomainChar(text.charCodeAt(end))) end += 1;
  while (end > at + 1 && (text[end - 1] === '.' || text[end - 1] === '-')) end -= 1;
  const domain = text.slice(at + 1, end);
  if (!validDomain(domain, 2)) return null;
  const address = text.slice(start, end);
  return { start, end, segment: { type: 'email', text: address, href: `mailto:${address}` } };
}

function phoneBoundary(text: string, index: number): boolean {
  const c = code(text, index - 1);
  if (c === -1) return true;
  if (isAlnum(c)) return false;
  return c !== 0x2e && c !== 0x2d && c !== 0x2f && c !== 0x5f && c !== 0x2b && c !== 0x40 && c !== 0x23 && c !== 0x26 && c !== 0x3d && c !== 0x25 && c !== 0x24;
}

/**
 * Scans a phone-shaped run at `start`. `scanned` is where the run ended, so a rejected run is skipped
 * as a whole and the scan stays linear.
 * 扫描从 `start` 开始、形似电话号码的一段。`scanned` 为该段结束位置，被拒绝的整段会被跳过，扫描保持线性。
 */
function matchPhone(text: string, start: number): { match: Match | null; scanned: number } {
  let index = start;
  if (text[index] === '+') index += 1;
  let digits = '';
  let lastDigitEnd = -1;
  let formatted = text[start] === '+';
  while (index < text.length) {
    const c = text.charCodeAt(index);
    if (isDigit(c)) {
      digits += text.charAt(index);
      lastDigitEnd = index + 1;
      index += 1;
      continue;
    }
    const next = code(text, index + 1);
    const separator = c === 0x20 || c === 0x2d || c === 0x28 || c === 0x29;
    if (!separator) break;
    // A separator only continues the number when more of it follows.
    // 只有后面还有号码时，分隔符才算号码的一部分。
    if (c === 0x29 ? !(isDigit(next) || next === 0x20 || next === 0x2d) : !(isDigit(next) || next === 0x28)) break;
    formatted = true;
    index += 1;
  }
  const scanned = Math.max(start + 1, index);
  if (lastDigitEnd === -1) return { match: null, scanned };
  if (digits.length < PHONE_DIGITS_MIN || digits.length > PHONE_DIGITS_MAX) return { match: null, scanned };
  if (!formatted && digits.length > PHONE_BARE_DIGITS_MAX) return { match: null, scanned };
  // A letter, '@' or a decimal point right after the digits means this is not a phone number.
  // 数字后紧跟字母、'@' 或小数点时，这不是电话号码。
  const after = code(text, lastDigitEnd);
  if (isLetter(after) || after === 0x40 || (after === 0x2e && isDigit(code(text, lastDigitEnd + 1)))) return { match: null, scanned };
  let begin = start;
  let raw = text.slice(begin, lastDigitEnd);
  if (raw.startsWith('(') && !raw.includes(')')) {
    begin += 1;
    raw = raw.slice(1);
  }
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(raw)) return { match: null, scanned };
  const href = `tel:${raw.startsWith('+') ? '+' : ''}${digits}`;
  return { match: { start: begin, end: lastDigitEnd, segment: { type: 'phone', text: raw, href } }, scanned };
}

export function linkify(text: string): LinkSegment[] {
  const segments: LinkSegment[] = [];
  let cursor = 0;
  let index = 0;

  function emit(match: Match) {
    if (match.start > cursor) segments.push({ type: 'text', text: text.slice(cursor, match.start) });
    segments.push(match.segment);
    cursor = match.end;
    index = match.end;
  }

  while (index < text.length) {
    const c = text.charCodeAt(index);
    const previous = code(text, index - 1);
    if ((c === 0x68 || c === 0x48 || c === 0x77 || c === 0x57) && !isAlnum(previous) && previous !== 0x2e) {
      const url = matchUrl(text, index);
      if (url) {
        emit(url);
        continue;
      }
    }
    if (c === 0x40) {
      const email = matchEmail(text, index, cursor);
      if (email) {
        emit(email);
        continue;
      }
    }
    if ((isDigit(c) || ((c === 0x2b || c === 0x28) && isDigit(code(text, index + 1)))) && phoneBoundary(text, index)) {
      const { match, scanned } = matchPhone(text, index);
      if (match) {
        emit(match);
        continue;
      }
      index = scanned;
      continue;
    }
    index += 1;
  }
  if (cursor < text.length) segments.push({ type: 'text', text: text.slice(cursor) });
  return segments;
}
