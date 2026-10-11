/**
 * Worker origin. The build injects VITE_API_BASE_URL; the fallback is the deployed Worker so a
 * plain `vite build` still points at production.
 * Worker 地址。构建时注入 VITE_API_BASE_URL；默认值指向已部署的 Worker，普通 `vite build` 也能直接可用。
 */
export const API_BASE_URL: string = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? 'https://utmmsc-api.wuyihang429.workers.dev';
