/**
 * The duration of a video as the tile's pill and the spoken labels show it: 0:15, 1:05, 1:02:03. Pure, so it
 * runs in Node.
 * 视频时长的显示格式，用于格子上的时长标签和读屏文字：0:15、1:05、1:02:03。纯函数，可以在 Node 中运行。
 */

/**
 * Rounds to the nearest second; anything above zero shows at least 0:01, so a very short clip never reads as
 * empty. Null for a missing or invalid duration (media posted before durations were recorded).
 * 四舍五入到秒；大于零的时长至少显示 0:01，很短的片段不会显示为空。时长缺失或无效（记录时长之前发布的媒体）时返回 null。
 */
export function formatVideoClock(ms: number | null | undefined): string | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return null;
  const total = ms > 0 ? Math.max(1, Math.round(ms / 1000)) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}
