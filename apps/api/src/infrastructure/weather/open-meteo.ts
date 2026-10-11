export interface WeatherNow {
  temperatureC: number;
  apparentC: number;
  description: string;
  precipitationChance: number | null;
}

/** WMO weather interpretation codes mapped to short Chinese descriptions. */
/** WMO 天气代码对应的简短中文描述。 */
const WMO_DESCRIPTIONS: Record<number, string> = {
  0: '晴',
  1: '大致晴朗',
  2: '多云',
  3: '阴',
  45: '雾',
  48: '冻雾',
  51: '小毛毛雨',
  53: '毛毛雨',
  55: '大毛毛雨',
  56: '冻毛毛雨',
  57: '冻毛毛雨',
  61: '小雨',
  63: '中雨',
  65: '大雨',
  66: '冻雨',
  67: '冻雨',
  71: '小雪',
  73: '中雪',
  75: '大雪',
  77: '雪粒',
  80: '阵雨',
  81: '阵雨',
  82: '强阵雨',
  85: '阵雪',
  86: '强阵雪',
  95: '雷暴',
  96: '雷暴伴冰雹',
  99: '雷暴伴冰雹',
};

interface OpenMeteoResponse {
  current?: { temperature_2m?: number; apparent_temperature?: number; weather_code?: number };
  daily?: { precipitation_probability_max?: number[] };
}

/**
 * Open-Meteo needs no key. Responses are cached at the edge for thirty minutes so a busy home
 * screen does not hammer the upstream.
 * Open-Meteo 无需密钥。响应在边缘缓存三十分钟，避免首页频繁访问上游。
 */
export async function fetchWeather(latitude: string, longitude: string, timezone: string): Promise<WeatherNow | null> {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', latitude);
  url.searchParams.set('longitude', longitude);
  url.searchParams.set('timezone', timezone);
  url.searchParams.set('current', 'temperature_2m,apparent_temperature,weather_code');
  url.searchParams.set('daily', 'precipitation_probability_max');
  url.searchParams.set('forecast_days', '1');
  try {
    const response = await fetch(url.toString(), { cf: { cacheTtl: 1800, cacheEverything: true } });
    if (!response.ok) return null;
    const data = (await response.json()) as OpenMeteoResponse;
    const current = data.current;
    if (!current || typeof current.temperature_2m !== 'number') return null;
    const code = current.weather_code ?? -1;
    return {
      temperatureC: Math.round(current.temperature_2m),
      apparentC: Math.round(current.apparent_temperature ?? current.temperature_2m),
      description: WMO_DESCRIPTIONS[code] ?? '未知',
      precipitationChance: data.daily?.precipitation_probability_max?.[0] ?? null,
    };
  } catch {
    return null;
  }
}
