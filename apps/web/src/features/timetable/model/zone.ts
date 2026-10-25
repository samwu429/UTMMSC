/**
 * Owner: T3, timetable web core. Whether this device keeps a clock other than Toronto's, so the week view adds
 * the small 按多伦多时间 label (for a member at home in Beijing over the break, say).
 * 维护者：T3，课表网页核心。这台设备的时钟是否与多伦多不同，从而让周课表加上小字「按多伦多时间」（例如假期回到北京的成员）。
 */
import { wallClockAt } from '@utmmsc/shared';

/** Toronto's offset from UTC at an instant, in minutes (-240 in summer, -300 in winter). */
/** 某一时刻多伦多相对 UTC 的偏移（分钟），夏季为 -240，冬季为 -300。 */
export function torontoOffsetMin(nowMs: number): number {
  const w = wallClockAt(nowMs);
  const wallMs = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute);
  return Math.round((wallMs - Math.floor(nowMs / 60_000) * 60_000) / 60_000);
}

/**
 * True when the device's offset differs from Toronto's at this instant. deviceOffsetMin is minutes east of UTC,
 * the negated Date#getTimezoneOffset.
 * 设备此刻的偏移与多伦多不同时为 true。deviceOffsetMin 为 UTC 以东的分钟数，即 Date#getTimezoneOffset 的相反数。
 */
export function deviceDiffersFromToronto(nowMs: number, deviceOffsetMin: number): boolean {
  return torontoOffsetMin(nowMs) !== deviceOffsetMin;
}

/** The same check for this device, now. */
/** 对这台设备、此刻做同样的检查。 */
export function thisDeviceDiffersFromToronto(): boolean {
  const now = Date.now();
  return deviceDiffersFromToronto(now, -new Date(now).getTimezoneOffset());
}
