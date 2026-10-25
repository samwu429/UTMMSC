import type { PushRelay } from './infrastructure/push/relay';

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
  /** Spreads large push fan-outs over several invocations; without it every push is sent inline. */
  /** 把大批量推送分散到多次调用中发送；没有此绑定时全部推送在本次调用内发送。 */
  PUSH_RELAY?: DurableObjectNamespace<PushRelay>;

  /** Comma-separated browser origins allowed by CORS. */
  /** CORS 允许的浏览器来源，逗号分隔。 */
  APP_ORIGIN: string;
  APP_BASE_URL: string;
  /**
   * The public address of this API, https://utmmsc.com/api, where the site Worker forwards /api/* to it. Absolute
   * URLs the server hands out start with it: notification icons, and room sockets for requests that came through
   * the site. Without it uploaded channel icons are left out of pushes, and preset icons still show.
   * 本接口的公开地址 https://utmmsc.com/api，网站 Worker 把 /api/* 转发到这里。服务器给出的绝对地址以它开头：通知图标，
   * 以及经由网站转发而来的请求所拿到的房间连接地址。没有它时，推送中不带上传的频道图标，预设图标照常显示。
   */
  API_PUBLIC_URL?: string;
  MAIL_FROM_EMAIL: string;
  MAIL_FROM_NAME: string;
  WEATHER_LATITUDE: string;
  WEATHER_LONGITUDE: string;
  WEATHER_TIMEZONE: string;
  /**
   * Web Push application server key (base64url), kept for reference: browsers are given the key derived
   * from VAPID_PRIVATE_KEY, and a mismatch is logged.
   * Web Push 应用服务器公钥（base64url），仅作对照：浏览器拿到的是由 VAPID_PRIVATE_KEY 推导出的公钥，两者不一致时会记录日志。
   */
  VAPID_PUBLIC_KEY?: string;

  SESSION_SECRET: string;
  BREVO_API_KEY?: string;
  /** Private VAPID key as a P-256 JWK JSON string, as scripts/vapid-keys.mjs writes it. */
  /** VAPID 私钥，为 P-256 JWK JSON 字符串，即 scripts/vapid-keys.mjs 写出的格式。 */
  VAPID_PRIVATE_KEY?: string;
  /** Firebase service-account JSON. Without it Android devices are skipped. */
  /** Firebase 服务账号 JSON。没有它时跳过安卓设备。 */
  FCM_SERVICE_ACCOUNT?: string;
}
