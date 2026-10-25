import { Hono } from 'hono';
import type { DailyCardResponse } from '@utmmsc/shared';
import { listUpcomingEvents, toEvent } from '../../../infrastructure/d1/events';
import { fetchWeather } from '../../../infrastructure/weather/open-meteo';
import type { AppEnv } from '../../context';
import { requireSession } from '../../middleware/session';
import { timetableRoutes } from './timetable';

export const homeRoutes = new Hono<AppEnv>();

// 自定义课表 at /home/timetable, with its own session check, limits and 503 before migration 0017.
// 自定义课表挂载在 /home/timetable，自带登录检查、频率限制，以及迁移 0017 之前的 503。
homeRoutes.route('/timetable', timetableRoutes);

const WEEKDAYS_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const WEEKDAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Date and weekday are computed in Toronto's timezone regardless of where the Worker runs. */
/** 日期与星期按多伦多时区计算，与 Worker 运行地点无关。 */
function torontoToday(timezone: string, lang: 'zh' | 'en'): { date: string; weekday: string } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const date = `${get('year')}-${get('month')}-${get('day')}`;
  const weekdayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  const names = lang === 'en' ? WEEKDAYS_EN : WEEKDAYS_ZH;
  return { date, weekday: names[weekdayIndex] ?? '' };
}

homeRoutes.get('/daily', requireSession, async (c) => {
  const lang = c.req.query('lang') === 'en' ? 'en' : 'zh';
  const [weather, events] = await Promise.all([
    fetchWeather(c.env.WEATHER_LATITUDE, c.env.WEATHER_LONGITUDE, c.env.WEATHER_TIMEZONE, lang),
    listUpcomingEvents(c.env.DB, 5),
  ]);
  const response: DailyCardResponse = { ...torontoToday(c.env.WEATHER_TIMEZONE, lang), weather, events: events.map(toEvent) };
  return c.json(response);
});
