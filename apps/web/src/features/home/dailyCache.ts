/**
 * Owner: T4 (with HomePage.tsx). The home page's daily card (date, weather, upcoming events), kept so Home shows the
 * last data at once and then refreshes quietly (perf-loading P1-8, perf-runtime P1-6). A module-level copy makes a
 * return to Home instant within the session; localStorage, one key per member (utmmsc.home.v1.<memberId>), does the
 * same across launches. Entries are read field by field, so a broken or old one is dropped instead of crashing, and
 * every entry goes on sign-out. Blocked or full storage only means there is no cache.
 * 维护者：T4（与 HomePage.tsx 一起）。首页的每日卡片（日期、天气、近期活动），保存下来使首页能立即显示上次的内容，再安静地刷新
 * （perf-loading P1-8、perf-runtime P1-6）。模块内的副本让同一次使用中回到首页时立即显示；localStorage 中每位成员一个键
 * （utmmsc.home.v1.<memberId>），在下次启动时起同样的作用。记录逐字段读取，损坏或旧版本的记录会被丢弃而不会导致崩溃；
 * 退出登录时删除所有记录。存储被禁用或已满只意味着没有缓存。
 */
import { torontoDateOf, type DailyCardResponse, type EventRecord } from '@utmmsc/shared';

export const DAILY_CACHE_VERSION = 1;
export const DAILY_CACHE_PREFIX = `utmmsc.home.v${DAILY_CACHE_VERSION}.`;
/** Older entries are dropped: a week-old event list helps nobody. */
/** 更早的记录会被丢弃：一周前的活动列表对谁都没用。 */
export const DAILY_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** A card fetched this recently is not fetched again on the way back to Home. */
/** 这么短时间之内获取过的卡片，回到首页时不再重新获取。 */
export const DAILY_FRESH_MS = 2 * 60 * 1000;

export type DailyLang = 'zh' | 'en';

export interface CachedDaily {
  card: DailyCardResponse;
  /** The language the server wrote the weekday and weather in. */
  /** 服务器写星期和天气所用的语言。 */
  lang: DailyLang;
  /** Date.now() of the fetch. */
  /** 获取时的 Date.now()。 */
  savedAt: number;
}

export type DailyCacheStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

/** localStorage, looked up on every call and never at import time; null when it cannot be reached. */
/** localStorage，每次调用时获取，导入时不访问；无法访问时为 null。 */
function defaultStorage(): DailyCacheStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function dailyCacheKey(memberId: string): string {
  return `${DAILY_CACHE_PREFIX}${memberId}`;
}

/* Reading field by field */
/* 逐字段读取 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function readEvent(value: unknown): EventRecord | null {
  if (!isRecord(value)) return null;
  const { id, title, startsAt, location, description } = value;
  if (typeof id !== 'string' || typeof title !== 'string' || typeof startsAt !== 'string' || Number.isNaN(Date.parse(startsAt))) return null;
  if (!isNullableString(location) || !isNullableString(description)) return null;
  return { id, title, startsAt, location, description };
}

/** A daily card as the page needs it, or null when any field is missing or of the wrong type. */
/** 页面所需的每日卡片；任一字段缺失或类型不对时为 null。 */
export function readDailyCard(value: unknown): DailyCardResponse | null {
  if (!isRecord(value)) return null;
  const { date, weekday, weather, events } = value;
  if (typeof date !== 'string' || typeof weekday !== 'string' || !Array.isArray(events)) return null;
  let readWeather: DailyCardResponse['weather'] = null;
  if (weather !== null) {
    if (!isRecord(weather)) return null;
    const { temperatureC, apparentC, description, precipitationChance } = weather;
    if (!isNumber(temperatureC) || !isNumber(apparentC) || typeof description !== 'string' || !(precipitationChance === null || isNumber(precipitationChance))) return null;
    readWeather = { temperatureC, apparentC, description, precipitationChance };
  }
  const readEvents: EventRecord[] = [];
  for (const item of events) {
    const event = readEvent(item);
    if (!event) return null;
    readEvents.push(event);
  }
  return { date, weekday, weather: readWeather, events: readEvents };
}

/* Storage */
/* 存储 */

function removeKey(storage: DailyCacheStorage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // Blocked storage has nothing to remove.
    // 存储被禁用时没有可删除的内容。
  }
}

/**
 * The member's stored card, or null: nothing stored, another version, member or language, too old, unreadable, or
 * storage blocked. A broken or expired entry is removed.
 * 该成员保存的卡片；以下情况为 null：没有记录、版本、成员或语言不同、过旧、无法解析，或存储被禁用。损坏或过期的记录会被删除。
 */
export function readDailyCache(memberId: string, lang: DailyLang, now: number = Date.now(), storage: DailyCacheStorage | null = defaultStorage()): CachedDaily | null {
  if (!storage) return null;
  const key = dailyCacheKey(memberId);
  let text: string | null;
  try {
    text = storage.getItem(key);
  } catch {
    return null;
  }
  if (text === null) return null;
  let value: unknown = null;
  try {
    value = JSON.parse(text);
  } catch {
    value = null;
  }
  const card = isRecord(value) && value.v === DAILY_CACHE_VERSION && value.memberId === memberId ? readDailyCard(value.card) : null;
  const savedAt = isRecord(value) && isNumber(value.savedAt) ? value.savedAt : Number.NaN;
  const storedLang = isRecord(value) && (value.lang === 'zh' || value.lang === 'en') ? value.lang : null;
  // Too old, or saved under a clock far ahead of this one.
  // 过旧，或者是在比现在快很多的时钟下保存的。
  if (!card || !storedLang || Number.isNaN(savedAt) || Math.abs(now - savedAt) > DAILY_CACHE_MAX_AGE_MS) {
    removeKey(storage, key);
    return null;
  }
  // The other language's card stays for when the member switches back.
  // 另一种语言的卡片保留着，成员切换回来时还能用。
  if (storedLang !== lang) return null;
  return { card, lang: storedLang, savedAt };
}

/** Saves the member's card; false when it could not be stored. */
/** 保存该成员的卡片；无法保存时返回 false。 */
export function writeDailyCache(memberId: string, entry: CachedDaily, storage: DailyCacheStorage | null = defaultStorage()): boolean {
  if (!storage) return false;
  const key = dailyCacheKey(memberId);
  try {
    storage.setItem(key, JSON.stringify({ v: DAILY_CACHE_VERSION, memberId, lang: entry.lang, savedAt: entry.savedAt, card: entry.card }));
    return true;
  } catch {
    // A full quota must not leave an older card behind.
    // 空间已满时不能留下更旧的卡片。
    removeKey(storage, key);
    return false;
  }
}

/** Removes every member's entry, including entries of older versions. */
/** 删除所有成员的记录，包括旧版本的记录。 */
export function clearDailyCache(storage: DailyCacheStorage | null = defaultStorage()): void {
  if (!storage) return;
  const keys: string[] = [];
  try {
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key && /^utmmsc\.home\.v\d+\./.test(key)) keys.push(key);
    }
  } catch {
    return;
  }
  for (const key of keys) removeKey(storage, key);
}

/* The copy kept in memory for this session */
/* 本次使用中保存在内存里的副本 */

let memory: { memberId: string; entry: CachedDaily } | null = null;

/** What Home shows on first paint: this session's copy, else the stored one. */
/** 首页首次绘制时显示的内容：本次使用中的副本，否则为保存的记录。 */
export function initialDaily(memberId: string, lang: DailyLang, now: number = Date.now(), storage: DailyCacheStorage | null = defaultStorage()): CachedDaily | null {
  if (memory && memory.memberId === memberId && memory.entry.lang === lang && Math.abs(now - memory.entry.savedAt) <= DAILY_CACHE_MAX_AGE_MS) return memory.entry;
  const stored = readDailyCache(memberId, lang, now, storage);
  if (stored) memory = { memberId, entry: stored };
  return stored;
}

/** Keeps a freshly fetched card in memory and on the device. */
/** 把刚获取的卡片保存在内存和这台设备上。 */
export function rememberDaily(memberId: string, entry: CachedDaily, storage: DailyCacheStorage | null = defaultStorage()): void {
  memory = { memberId, entry };
  writeDailyCache(memberId, entry, storage);
}

/** Sign-out or a member switch: nothing of the last member's card stays. */
/** 退出登录或切换成员：上一位成员的卡片一点都不保留。 */
export function forgetDaily(storage: DailyCacheStorage | null = defaultStorage()): void {
  memory = null;
  clearDailyCache(storage);
}

/** Whether Home should fetch: nothing shown yet, or what is shown is older than DAILY_FRESH_MS. */
/** 首页是否需要获取：还没有可显示的内容，或显示的内容早于 DAILY_FRESH_MS。 */
export function needsRefresh(entry: CachedDaily | null, now: number = Date.now()): boolean {
  return !entry || now - entry.savedAt >= DAILY_FRESH_MS || now < entry.savedAt;
}

export interface PresentedDaily {
  card: DailyCardResponse;
  /** Saved on an earlier Toronto day, so its date, weekday and weather are not today's. */
  /** 在多伦多更早的一天保存，因此其日期、星期和天气都不是今天的。 */
  staleDay: boolean;
}

const WEEKDAYS_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const WEEKDAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Today's Toronto weekday written as the server writes it: 周六 / Saturday. */
/** 按服务器的写法写出多伦多今天是星期几：周六 / Saturday。 */
export function torontoWeekdayName(date: string, lang: DailyLang): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const index = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return (lang === 'en' ? WEEKDAYS_EN : WEEKDAYS_ZH)[index] ?? '';
}

/**
 * The card as Home shows it now: events that have started are left out, and a card from an earlier Toronto day
 * takes today's date and weekday, its weather marked stale until the refresh lands.
 * 首页此刻显示的卡片：已经开始的活动不再显示；更早一天保存的卡片换成今天的日期和星期，天气标为过时，直到刷新完成。
 */
export function presentDaily(entry: CachedDaily, now: number = Date.now()): PresentedDaily {
  const today = torontoDateOf(now);
  const events = entry.card.events.filter((event) => Date.parse(event.startsAt) >= now);
  if (entry.card.date === today) return { card: events.length === entry.card.events.length ? entry.card : { ...entry.card, events }, staleDay: false };
  return { card: { date: today, weekday: torontoWeekdayName(today, entry.lang), weather: entry.card.weather, events }, staleDay: true };
}
