/**
 * Owner: T3, timetable web core. The app's one timetable store (timetable-final.md section 12): zustand persist under
 * utmmsc.timetable.v1 through safeLocalStorage, hydrated synchronously so the home card has data on first paint,
 * reset on sign-out or a member switch, writes applied at once and sent from the outbox one at a time. The logic
 * lives in createTimetableStore.ts; this file wires it to the session, the language, the network and the page.
 * Only the store calls the API, so every write goes through the outbox.
 * 维护者：T3，课表网页核心。App 唯一的课表 store（timetable-final.md 第 12 节）：通过 safeLocalStorage 以 utmmsc.timetable.v1 保存的
 * zustand persist，同步恢复，因此首页卡片在首次绘制时就有数据；退出登录或切换成员时重置；写入立即生效，并从发送队列逐条发送。
 * 逻辑在 createTimetableStore.ts 中；本文件把它与会话、语言、网络和页面连接起来。只有 store 调用接口，因此每次写入都经过发送队列。
 */
import { useMemo } from 'react';
import type {
  ImportTimetableBody,
  ImportTimetableCounts,
  SaveAssignmentBody,
  SaveCourseBody,
  SaveTermBody,
  SetSkipBody,
  UpdateTimetableSettingsBody,
} from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { useLocaleStore } from '../../../shared/i18n/locale';
import { useSessionStore } from '../../../shared/session/store';
import { toast } from '../../../shared/ui/toast';
import { safeLocalStorage } from '../../chat/state/safeStorage';
import { timetableApi } from '../api';
import { createTimetableStore } from './createTimetableStore';
import { pendingFromSignature, pendingSignature, viewOf, type TimetableView } from './view';

export type { TimetableMutation, TimetableOutboxItem, TimetableState } from './types';
export type { TimetableView } from './view';

type SessionSlice = { token: string | null; member: { id: string } | null };

function memberOf(state: SessionSlice): string | null {
  return state.token ? (state.member?.id ?? null) : null;
}

let idSeq = 0;

/** A local id for an outbox item; it never leaves the device. */
/** 发送队列条目的本地 id；不会离开这台设备。 */
function localId(): string {
  idSeq += 1;
  return `${Date.now().toString(36)}-${idSeq.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Page shown again or network back; nothing is installed outside a browser. */
/** 页面重新显示或网络恢复；浏览器以外不安装任何监听。 */
function onWake(listener: () => void): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => undefined;
  const onVisible = () => {
    if (document.visibilityState === 'visible') listener();
  };
  window.addEventListener('online', listener);
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    window.removeEventListener('online', listener);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

const store = createTimetableStore({
  api: timetableApi,
  storage: safeLocalStorage,
  now: () => Date.now(),
  currentMember: () => memberOf(useSessionStore.getState()),
  onMemberChange: (listener) =>
    useSessionStore.subscribe((state, prev) => {
      const next = memberOf(state);
      if (next !== memberOf(prev)) listener(next);
    }),
  appLocale: () => useLocaleStore.getState().locale,
  onLocaleChange: (listener) =>
    useLocaleStore.subscribe((state, prev) => {
      if (state.locale !== prev.locale) listener();
    }),
  isOnline: () => typeof navigator === 'undefined' || navigator.onLine !== false,
  onWake,
  report: (error) => toast(errorMessage(error)),
  newId: localId,
});

export const useTimetable = store.useStore;

export function useTimetableView(): TimetableView {
  const snapshot = useTimetable((state) => state.snapshot);
  const signature = useTimetable((state) => pendingSignature(state.outbox));
  const pendingIds = useMemo(() => pendingFromSignature(signature), [signature]);
  return useMemo(() => viewOf(snapshot, pendingIds), [snapshot, pendingIds]);
}

/** Queued writes and whether the last send is waiting for the network or the server. */
/** 排队写入的数量，以及上一次发送是否在等待网络或服务器。 */
export function useTimetableSync(): { pending: number; stalled: boolean } {
  const pending = useTimetable((state) => state.outbox.length);
  const stalled = useTimetable((state) => state.stalled);
  return useMemo(() => ({ pending, stalled }), [pending, stalled]);
}

/** Fetches with ?rev; throttled unless forced. */
/** 带 ?rev 获取；除非强制，否则会限制频率。 */
export function refresh(options: { force?: boolean } = {}): Promise<void> {
  return store.actions.refresh(options);
}

/* Writes apply at once and sync in the background. */
/* 写入立即生效，并在后台同步。 */

export function saveCourse(body: SaveCourseBody): void {
  store.actions.saveCourse(body);
}

export function deleteCourse(id: string): void {
  store.actions.deleteCourse(id);
}

export function saveTerm(body: SaveTermBody): void {
  store.actions.saveTerm(body);
}

export function deleteTerm(id: string): void {
  store.actions.deleteTerm(id);
}

export function saveAssignment(body: SaveAssignmentBody): void {
  store.actions.saveAssignment(body);
}

export function setAssignmentDone(id: string, done: boolean): void {
  store.actions.setAssignmentDone(id, done);
}

export function deleteAssignment(id: string): void {
  store.actions.deleteAssignment(id);
}

export function setSkip(body: SetSkipBody): void {
  store.actions.setSkip(body);
}

export function updateSettings(patch: UpdateTimetableSettingsBody): void {
  store.actions.updateSettings(patch);
}

/** Online only: sends the whole import at once, then fetches the timetable again. */
/** 仅限联网：一次发送全部导入内容，然后重新获取课表。 */
export function importAll(body: ImportTimetableBody): Promise<ImportTimetableCounts> {
  return store.actions.importAll(body);
}

/** 清空课表: terms, courses, skips and assignments; settings stay. */
/** 清空课表：学期、课程、停课和作业；设置保留。 */
export function clearAll(): Promise<void> {
  return store.actions.clearAll();
}
