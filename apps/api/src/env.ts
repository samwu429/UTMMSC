/**
 * Bindings and variables available to the Worker. Mirrors wrangler.jsonc plus secrets.
 * Worker 可用的绑定与变量。与 wrangler.jsonc 及 secrets 对应。
 */
export interface Env {
  DB: D1Database;
  /** Absent until R2 is enabled on the Cloudflare account; file routes answer 503 without it. */
  /** Cloudflare 账号开通 R2 前此绑定不存在；届时文件接口返回 503。 */
  FILES?: R2Bucket;
  CHAT_ROOMS: DurableObjectNamespace;

  /** Comma-separated browser origins allowed by CORS. */
  /** CORS 允许的浏览器来源，逗号分隔。 */
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
