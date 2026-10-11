/**
 * Bindings and variables available to the Worker. Mirrors wrangler.jsonc plus secrets.
 * Worker 可用的绑定与变量。与 wrangler.jsonc 及 secrets 对应。
 */
export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  CHAT_ROOMS: DurableObjectNamespace;

  APP_ORIGIN: string;
  APP_BASE_URL: string;
  MAIL_FROM_EMAIL: string;
  MAIL_FROM_NAME: string;
  WEATHER_LATITUDE: string;
  WEATHER_LONGITUDE: string;
  WEATHER_TIMEZONE: string;

  SESSION_SECRET: string;
  BREVO_API_KEY?: string;
}
