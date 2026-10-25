import { beforeEach, describe, expect, it } from 'vitest';
import type { DailyCardResponse } from '@utmmsc/shared';
import {
  DAILY_CACHE_MAX_AGE_MS,
  DAILY_FRESH_MS,
  clearDailyCache,
  dailyCacheKey,
  forgetDaily,
  initialDaily,
  needsRefresh,
  presentDaily,
  readDailyCache,
  readDailyCard,
  rememberDaily,
  torontoWeekdayName,
  writeDailyCache,
  type CachedDaily,
  type DailyCacheStorage,
} from './dailyCache';

/** Saturday 2026-10-24, 12:00 in Toronto. */
/** 多伦多时间 2026-10-24 周六 12:00。 */
const NOW = Date.UTC(2026, 9, 24, 16, 0);

class MemoryStorage implements DailyCacheStorage {
  map = new Map<string, string>();
  failWrites = false;
  get length() {
    return this.map.size;
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error('QuotaExceededError');
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
}

const card: DailyCardResponse = {
  date: '2026-10-24',
  weekday: '周六',
  weather: { temperatureC: 9, apparentC: 6, description: '多云', precipitationChance: 20 },
  events: [
    { id: 'ev_1', title: 'Board games', startsAt: '2026-10-24T22:00:00.000Z', location: 'DV 2074', description: null },
    { id: 'ev_2', title: 'Hike', startsAt: '2026-10-31T14:00:00.000Z', location: null, description: 'Bring water' },
  ],
};

const entry: CachedDaily = { card, lang: 'zh', savedAt: NOW };

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  forgetDaily(storage);
});

describe('readDailyCard', () => {
  it('accepts a card with or without weather', () => {
    expect(readDailyCard(card)).toEqual(card);
    expect(readDailyCard({ ...card, weather: null })).toEqual({ ...card, weather: null });
    expect(readDailyCard({ ...card, weather: { ...card.weather, precipitationChance: null } })?.weather?.precipitationChance).toBeNull();
  });

  it('refuses anything with a missing or wrong field', () => {
    expect(readDailyCard(null)).toBeNull();
    expect(readDailyCard({ ...card, date: 1 })).toBeNull();
    expect(readDailyCard({ ...card, events: [{ id: 'x', title: 'x', startsAt: 'never', location: null, description: null }] })).toBeNull();
    expect(readDailyCard({ ...card, weather: { temperatureC: '9' } })).toBeNull();
  });
});

describe('storage', () => {
  it('writes and reads one entry per member', () => {
    expect(writeDailyCache('m1', entry, storage)).toBe(true);
    expect(readDailyCache('m1', 'zh', NOW, storage)).toEqual(entry);
    expect(readDailyCache('m2', 'zh', NOW, storage)).toBeNull();
  });

  it('keeps the other language for later but does not show it', () => {
    writeDailyCache('m1', entry, storage);
    expect(readDailyCache('m1', 'en', NOW, storage)).toBeNull();
    expect(storage.getItem(dailyCacheKey('m1'))).not.toBeNull();
  });

  it('drops old, broken and foreign entries', () => {
    writeDailyCache('m1', entry, storage);
    expect(readDailyCache('m1', 'zh', NOW + DAILY_CACHE_MAX_AGE_MS + 1, storage)).toBeNull();
    expect(storage.getItem(dailyCacheKey('m1'))).toBeNull();
    storage.setItem(dailyCacheKey('m1'), '{not json');
    expect(readDailyCache('m1', 'zh', NOW, storage)).toBeNull();
    storage.setItem(dailyCacheKey('m1'), JSON.stringify({ v: 1, memberId: 'm2', lang: 'zh', savedAt: NOW, card }));
    expect(readDailyCache('m1', 'zh', NOW, storage)).toBeNull();
    storage.setItem(dailyCacheKey('m1'), JSON.stringify({ v: 0, memberId: 'm1', lang: 'zh', savedAt: NOW, card }));
    expect(readDailyCache('m1', 'zh', NOW, storage)).toBeNull();
  });

  it('never throws when storage is blocked or full', () => {
    storage.failWrites = true;
    expect(writeDailyCache('m1', entry, storage)).toBe(false);
    expect(writeDailyCache('m1', entry, null)).toBe(false);
    expect(readDailyCache('m1', 'zh', NOW, null)).toBeNull();
    expect(() => clearDailyCache(null)).not.toThrow();
  });

  it('clears every member and older versions, and nothing else', () => {
    writeDailyCache('m1', entry, storage);
    writeDailyCache('m2', entry, storage);
    storage.setItem('utmmsc.home.v0.m1', 'old');
    storage.setItem('utmmsc.session', 'keep');
    clearDailyCache(storage);
    expect([...storage.map.keys()]).toEqual(['utmmsc.session']);
  });
});

describe('the copy in memory', () => {
  it('serves a return to Home from memory and a new launch from storage', () => {
    expect(initialDaily('m1', 'zh', NOW, storage)).toBeNull();
    rememberDaily('m1', entry, storage);
    // Memory first, even with storage gone.
    // 先用内存中的副本，即使存储已经不在。
    expect(initialDaily('m1', 'zh', NOW, null)).toBe(entry);
    forgetDaily(storage);
    expect(initialDaily('m1', 'zh', NOW, storage)).toBeNull();
    writeDailyCache('m1', entry, storage);
    expect(initialDaily('m1', 'zh', NOW, storage)).toEqual(entry);
  });

  it('never serves another member or language from memory', () => {
    rememberDaily('m1', entry, storage);
    expect(initialDaily('m2', 'zh', NOW, null)).toBeNull();
    expect(initialDaily('m1', 'en', NOW, null)).toBeNull();
  });

  it('forgets everything on sign-out', () => {
    rememberDaily('m1', entry, storage);
    forgetDaily(storage);
    expect(storage.length).toBe(0);
    expect(initialDaily('m1', 'zh', NOW, null)).toBeNull();
  });

  it('refreshes unless the card was fetched moments ago', () => {
    expect(needsRefresh(null, NOW)).toBe(true);
    expect(needsRefresh(entry, NOW + DAILY_FRESH_MS - 1)).toBe(false);
    expect(needsRefresh(entry, NOW + DAILY_FRESH_MS)).toBe(true);
    expect(needsRefresh(entry, NOW - 1)).toBe(true);
  });
});

describe('presentDaily', () => {
  it('shows today’s card as it is, minus events that have started', () => {
    expect(presentDaily(entry, NOW)).toEqual({ card, staleDay: false });
    expect(presentDaily(entry, Date.UTC(2026, 9, 24, 23, 0)).card.events.map((event) => event.id)).toEqual(['ev_2']);
  });

  it('gives an earlier day’s card today’s date and weekday and marks it stale', () => {
    const tomorrow = Date.UTC(2026, 9, 25, 14, 0);
    expect(presentDaily(entry, tomorrow)).toEqual({
      card: { date: '2026-10-25', weekday: '周日', weather: card.weather, events: [card.events[1]] },
      staleDay: true,
    });
    expect(presentDaily({ ...entry, lang: 'en' }, tomorrow).card.weekday).toBe('Sunday');
  });

  it('writes weekdays as the server does', () => {
    expect(torontoWeekdayName('2026-10-24', 'zh')).toBe('周六');
    expect(torontoWeekdayName('2026-10-26', 'en')).toBe('Monday');
  });
});
