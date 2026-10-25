/**
 * Owner: T3, timetable web core. The store's data shapes, kept apart from the store so the pure modules
 * (applyMutation, outbox, persisted) need nothing that touches the browser. timetableStore.ts re-exports them.
 * 维护者：T3，课表网页核心。store 的数据结构，与 store 分开存放，使纯函数模块（applyMutation、outbox、persisted）
 * 不依赖任何浏览器功能。timetableStore.ts 会重新导出它们。
 */
import type {
  SaveAssignmentBody,
  SaveCourseBody,
  SaveTermBody,
  SetSkipBody,
  TimetableResponse,
  UpdateTimetableSettingsBody,
} from '@utmmsc/shared';

/** One queued write, replayed in order once the app is online. */
/** 一次排队的写入，联网后按顺序重放。 */
export type TimetableMutation =
  | { kind: 'saveCourse'; body: SaveCourseBody }
  | { kind: 'deleteCourse'; id: string }
  | { kind: 'saveTerm'; body: SaveTermBody }
  | { kind: 'deleteTerm'; id: string }
  | { kind: 'saveAssignment'; body: SaveAssignmentBody }
  | { kind: 'setAssignmentDone'; id: string; done: boolean }
  | { kind: 'deleteAssignment'; id: string }
  | { kind: 'setSkip'; body: SetSkipBody }
  | { kind: 'updateSettings'; patch: UpdateTimetableSettingsBody }
  | { kind: 'clear' };

export interface TimetableOutboxItem {
  /** Coalescing key: a later write to the same item replaces a queued one. */
  /** 合并键：对同一条目的后续写入会替换已排队的写入。 */
  key: string;
  mutation: TimetableMutation;
  attempts: number;
  /** Date.now() when it was queued; replaying the item stamps this time, so a replay gives the same result. */
  /** 排队时的 Date.now()；重放时使用这个时间，因此重放的结果相同。 */
  queuedAt: number;
  /** Tells two items apart while one of them is being sent. */
  /** 在其中一条正在发送时区分两条写入。 */
  id?: string;
  /**
   * The write creates something the server does not have yet, so deleting it before it is sent cancels both.
   * 这次写入创建的是服务器上还没有的条目，因此在发送前删除它会让两者一起取消。
   */
  fresh?: boolean;
}

/** What is kept on the device under utmmsc.timetable.v1. */
/** 在这台设备上以 utmmsc.timetable.v1 保存的内容。 */
export interface PersistedTimetable {
  memberId: string | null;
  snapshot: TimetableResponse | null;
  outbox: TimetableOutboxItem[];
  dismissedEmpty: boolean;
}

export interface TimetableState extends PersistedTimetable {
  /** The home card's empty state was dismissed on this device. */
  /** 这台设备上已关闭首页卡片的空状态。 */
  setDismissedEmpty: (value: boolean) => void;
  /**
   * The last send failed for want of a network or a working server, and it will be tried again. Not persisted.
   * 上一次发送因网络或服务器问题失败，之后会重试。不会保存。
   */
  stalled: boolean;
}
