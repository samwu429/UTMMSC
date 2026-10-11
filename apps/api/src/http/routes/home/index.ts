import { Hono } from 'hono';
import type { DailyCardResponse } from '@utmmsc/shared';
import { listUpcomingEvents, toEvent } from '../../../infrastructure/d1/events';
import { fetchWeather } from '../../../infrastructure/weather/open-meteo';
import type { AppEnv } from '../../context';
import { requireSession } from '../../middleware/session';

export const homeRoutes = new Hono<AppEnv>();

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** Date and weekday are computed in Toronto's timezone regardless of where the Worker runs. */
/** 日期与星期按多伦多时区计算，与 Worker 运行地点无关。 */
function torontoToday(timezone: string): { date: string; weekday: string } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const date = `${get('year')}-${get('month')}-${get('day')}`;
  const weekdayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { date, weekday: WEEKDAYS[weekdayIndex] ?? '' };
}

homeRoutes.get('/daily', requireSession, async (c) => {
  const [weather, events] = await Promise.all([
    fetchWeather(c.env.WEATHER_LATITUDE, c.env.WEATHER_LONGITUDE, c.env.WEATHER_TIMEZONE),
    listUpcomingEvents(c.env.DB, 5),
  ]);
  const response: DailyCardResponse = { ...torontoToday(c.env.WEATHER_TIMEZONE), weather, events: events.map(toEvent) };
  return c.json(response);
});
