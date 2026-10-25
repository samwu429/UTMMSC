/**
 * Owner: T3, timetable web core. Small choices remembered on this device only: the list view (列表视图) and the
 * length of the last class added (上次用的). Neither is private, so they stay across members, and they read as the
 * defaults when storage is blocked.
 * 维护者：T3，课表网页核心。只保存在这台设备上的小选项：列表视图，以及上次添加的课的时长（上次用的）。两者都不涉及隐私，因此换成员后仍保留；
 * 存储被禁用时按默认值读取。
 */
import { useSyncExternalStore } from 'react';
import { TIMETABLE_DAY_END_MIN, TIMETABLE_DAY_START_MIN, TIMETABLE_MEETING_MIN_MIN } from '@utmmsc/shared';
import { safeLocalStorage } from '../../chat/state/safeStorage';

const VIEW_KEY = 'utmmsc.timetable.view';
const DURATION_KEY = 'utmmsc.timetable.duration';

export type TimetableViewMode = 'grid' | 'list';

const listeners = new Set<() => void>();

function emit() {
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function readViewMode(): TimetableViewMode {
  return safeLocalStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid';
}

export function setViewMode(mode: TimetableViewMode): void {
  safeLocalStorage.setItem(VIEW_KEY, mode);
  emit();
}

export function useViewMode(): TimetableViewMode {
  return useSyncExternalStore(subscribe, readViewMode, () => 'grid');
}

/** The last class length used, in minutes, or null before the first class is added. */
/** 上次使用的课程时长（分钟）；添加第一节课之前为 null。 */
export function readLastDuration(): number | null {
  const value = Number(safeLocalStorage.getItem(DURATION_KEY));
  if (!Number.isInteger(value) || value < TIMETABLE_MEETING_MIN_MIN || value > TIMETABLE_DAY_END_MIN - TIMETABLE_DAY_START_MIN || value % 5 !== 0) return null;
  return value;
}

export function rememberDuration(minutes: number): void {
  if (Number.isInteger(minutes) && minutes >= TIMETABLE_MEETING_MIN_MIN) safeLocalStorage.setItem(DURATION_KEY, String(minutes));
}
