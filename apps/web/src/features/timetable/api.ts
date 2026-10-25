/**
 * Owner: T3, timetable web core. Calls of the /home/timetable routes; only the store calls them, so every write goes
 * through its optimistic outbox.
 * 维护者：T3，课表网页核心。/home/timetable 接口的调用；只有 store 调用它们，因此每次写入都经过 store 的乐观发送队列。
 */
import type {
  DeleteTimetableItemResponse,
  ImportTimetableBody,
  ImportTimetableResponse,
  SaveAssignmentBody,
  SaveAssignmentResponse,
  SaveCourseBody,
  SaveCourseResponse,
  SaveTermBody,
  SaveTermResponse,
  SetSkipBody,
  SetSkipResponse,
  TimetableResponse,
  TimetableUnchanged,
  UpdateTimetableSettingsBody,
  UpdateTimetableSettingsResponse,
} from '@utmmsc/shared';
import { api } from '../../shared/api/client';

const BASE = '/home/timetable';

function item(path: string, id: string): string {
  return `${BASE}/${path}/${encodeURIComponent(id)}`;
}

/** Whether a GET answered that nothing changed since the rev the app sent. */
/** GET 是否答复自 App 发送的 rev 以来没有变化。 */
export function isTimetableUnchanged(response: TimetableResponse | TimetableUnchanged): response is TimetableUnchanged {
  return 'unchanged' in response && response.unchanged === true;
}

export const timetableApi = {
  /** With rev, the server answers { unchanged: true } when the member's rev is still the same. */
  /** 带上 rev 时，若成员的 rev 未变，服务器答复 { unchanged: true }。 */
  get: (rev?: number) => api<TimetableResponse | TimetableUnchanged>(rev === undefined ? BASE : `${BASE}?rev=${encodeURIComponent(String(rev))}`),
  saveCourse: (body: SaveCourseBody) => api<SaveCourseResponse>(`${BASE}/courses`, { method: 'POST', body }),
  deleteCourse: (id: string) => api<DeleteTimetableItemResponse>(item('courses', id), { method: 'DELETE' }),
  saveTerm: (body: SaveTermBody) => api<SaveTermResponse>(`${BASE}/terms`, { method: 'POST', body }),
  deleteTerm: (id: string) => api<DeleteTimetableItemResponse>(item('terms', id), { method: 'DELETE' }),
  saveAssignment: (body: SaveAssignmentBody) => api<SaveAssignmentResponse>(`${BASE}/assignments`, { method: 'POST', body }),
  setAssignmentDone: (id: string, done: boolean) => api<SaveAssignmentResponse>(item('assignments', id), { method: 'PATCH', body: { done } }),
  deleteAssignment: (id: string) => api<DeleteTimetableItemResponse>(item('assignments', id), { method: 'DELETE' }),
  setSkip: (body: SetSkipBody) => api<SetSkipResponse>(`${BASE}/skips`, { method: 'POST', body }),
  updateSettings: (body: UpdateTimetableSettingsBody) => api<UpdateTimetableSettingsResponse>(`${BASE}/settings`, { method: 'PATCH', body }),
  importAll: (body: ImportTimetableBody) => api<ImportTimetableResponse>(`${BASE}/import`, { method: 'POST', body }),
  clear: () => api<DeleteTimetableItemResponse>(`${BASE}/clear`, { method: 'POST' }),
};
