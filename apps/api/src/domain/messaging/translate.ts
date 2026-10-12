import { translationFromGoogle, translationFromMyMemory, type TranslateLang } from '@utmmsc/shared';

const TRANSLATE_TIMEOUT_MS = 8_000;

export function createSlotLimiter(limit: number, windowMs: number): (now: number) => boolean {
  let count = 0;
  let resetAt = 0;
  return (now) => {
    if (resetAt <= now) {
      count = 0;
      resetAt = now + windowMs;
    }
    if (count >= limit) return false;
    count += 1;
    return true;
  };
}

/**
 * MyMemory's free quota is shared by the worker's egress IP, so each isolate also caps calls.
 * The message text is sent upstream and must not be logged.
 * MyMemory 免费额度按 Worker 出口 IP 共享，因此每个隔离实例再限一次。消息正文会发给上游，禁止写入日志。
 */
export const takeTranslateSlot = createSlotLimiter(40, 60_000);

async function fetchJson(url: string, accept: string): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRANSLATE_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { accept, 'user-agent': 'UTMMSC' },
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchMyMemoryTranslation(text: string, pair: string): Promise<string | null> {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(pair)}`;
  const payload = await fetchJson(url, 'application/json');
  return payload === null ? null : translationFromMyMemory(payload);
}

function different(candidate: string | null, source: string): candidate is string {
  return !!candidate && candidate.trim() !== source.trim();
}

/**
 * Google first, then MyMemory. A shared worker IP often exhausts MyMemory's free quota,
 * which is why a chat translation used to come back empty.
 * 先用 Google，不行再用 MyMemory。Worker 共用出口 IP 很容易用完 MyMemory 的免费额度，聊天翻译就会失败。
 */
export async function fetchTranslation(text: string, source: TranslateLang, target: TranslateLang): Promise<string | null> {
  const googleUrl = new URL('https://translate.googleapis.com/translate_a/single');
  googleUrl.searchParams.set('client', 'gtx');
  googleUrl.searchParams.set('sl', source);
  googleUrl.searchParams.set('tl', target);
  googleUrl.searchParams.set('dt', 't');
  googleUrl.searchParams.set('q', text);
  const googlePayload = await fetchJson(googleUrl.toString(), '*/*');
  const google = googlePayload === null ? null : translationFromGoogle(googlePayload);
  if (different(google, text)) return google;
  const memory = await fetchMyMemoryTranslation(text, `${source}|${target}`);
  if (different(memory, text)) return memory;
  return google ?? memory;
}
