/**
 * Owner: T4, timetable import and export. 导出课表: the calendar is built on the device and handed to saveFile,
 * which downloads it in a browser and opens the share sheet in the Android app. Nothing is sent to the server.
 * 维护者：T4，课表导入导出。「导出课表」：日历在设备上生成并交给 saveFile，浏览器中直接下载，安卓 App 中打开系统分享面板。不向服务器发送任何内容。
 */
import { useLocaleStore } from '../../../shared/i18n/locale';
import { saveFile, type SaveResult } from '../../../shared/native/native';
import type { TimetableView } from '../state/timetableStore';
import { ICS_FILE_NAME, ICS_MIME_TYPE, buildTimetableIcs } from './build';

export async function exportTimetable(view: TimetableView): Promise<SaveResult> {
  const text = buildTimetableIcs(view, { nowMs: Date.now(), locale: useLocaleStore.getState().locale });
  return saveFile(new Blob([text], { type: ICS_MIME_TYPE }), ICS_FILE_NAME, ICS_MIME_TYPE);
}
