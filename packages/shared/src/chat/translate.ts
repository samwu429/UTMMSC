/** MyMemory's anonymous query limit is 500 bytes. Stay under it. */
/** MyMemory 匿名查询上限是 500 字节。留出余量。 */
export const TRANSLATE_MAX_BYTES = 450;

export type TranslateLang = 'zh-CN' | 'en';

export type TranslatePlan =
  | { ok: true; text: string; pair: string; source: TranslateLang; target: TranslateLang }
  | { ok: false; error: 'empty' | 'too_long' };

const CJK = /[\u3400-\u9fff\uf900-\ufaff]/;
const UNUSABLE = /MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID LANGUAGE|INVALID SOURCE|INVALID TARGET|NO QUERY/i;

/** Chinese text goes to English. Everything else goes to Chinese. */
/** 含汉字的文本译成英文，其余译成中文。 */
export function planTranslation(text: string): TranslatePlan {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: 'empty' };
  if (new TextEncoder().encode(trimmed).length > TRANSLATE_MAX_BYTES) return { ok: false, error: 'too_long' };
  if (CJK.test(trimmed)) return { ok: true, text: trimmed, pair: 'zh-CN|en', source: 'zh-CN', target: 'en' };
  return { ok: true, text: trimmed, pair: 'en|zh-CN', source: 'en', target: 'zh-CN' };
}

function fromCodePoint(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 0x10ffff) return '';
  return String.fromCodePoint(value);
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code: string) => fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** Reads a MyMemory payload. Quota and error strings are treated as failure, not as a translation. */
/** 读取 MyMemory 响应。额度用尽和错误文案算失败，不当成译文。 */
export function translationFromMyMemory(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const record = payload as { responseStatus?: unknown; responseData?: { translatedText?: unknown } };
  const status = record.responseStatus;
  if (status !== 200 && status !== '200') return null;
  const raw = record.responseData?.translatedText;
  if (typeof raw !== 'string') return null;
  const text = decodeEntities(raw).trim();
  if (!text || UNUSABLE.test(text)) return null;
  return text.length > 4000 ? text.slice(0, 4000) : text;
}
