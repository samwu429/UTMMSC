import { translationFromMyMemory } from '@utmmsc/shared';

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

export async function fetchMyMemoryTranslation(text: string, pair: string): Promise<string | null> {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(pair)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRANSLATE_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    return translationFromMyMemory(payload);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
