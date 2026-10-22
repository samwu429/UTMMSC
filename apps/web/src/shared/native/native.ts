import { Capacitor } from '@capacitor/core';
import { tr } from '../i18n/locale';
import { base64FromDataUrl, byteChunks, safeFileName } from './fileName';

/** Where saved files wait in the app cache for the share sheet; each save clears the previous one. */
/** 保存的文件在应用缓存中等待分享面板的位置；每次保存会清掉上一次的文件。 */
const EXPORT_DIR = 'exports';
/** A multiple of 3, so every piece encodes to whole base64 groups. */
/** 取 3 的倍数，每一段都能编码成完整的 base64 分组。 */
const CHUNK_BYTES = 3 * 1024 * 1024;

export type SaveResult = 'saved' | 'cancelled';

/** True inside the Android app, false in every browser. */
/** 在安卓 App 内为 true，在任何浏览器中为 false。 */
export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

function downloadInBrowser(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function readBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(base64FromDataUrl(typeof reader.result === 'string' ? reader.result : ''));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(blob);
  });
}

function isCancel(error: unknown): boolean {
  return error instanceof Error && /cancel/i.test(error.message);
}

/**
 * The WebView ignores <a download>, so the app writes the file to its cache in pieces (the bridge
 * carries base64 text) and opens the system share sheet, where the user can save it to Files or send it.
 * WebView 不支持 <a download>，所以 App 把文件分段写入缓存（桥接只能传 base64 文本），再打开系统分享面板，用户可存到文件或发送出去。
 */
async function shareFromApp(blob: Blob, fileName: string): Promise<SaveResult> {
  const [{ Directory, Filesystem }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
  const path = `${EXPORT_DIR}/${fileName}`;
  await Filesystem.rmdir({ path: EXPORT_DIR, directory: Directory.Cache, recursive: true }).catch(() => undefined);
  let uri = '';
  for (const [index, chunk] of byteChunks(blob.size, CHUNK_BYTES).entries()) {
    const data = await readBase64(blob.slice(chunk.start, chunk.end));
    if (index === 0) uri = (await Filesystem.writeFile({ path, data, directory: Directory.Cache, recursive: true })).uri;
    else await Filesystem.appendFile({ path, data, directory: Directory.Cache });
  }
  try {
    await Share.share({ title: fileName, files: [uri], dialogTitle: tr('保存或发送', 'Save or send') });
    return 'saved';
  } catch (error) {
    if (isCancel(error)) return 'cancelled';
    throw error;
  }
}

/**
 * Saves a downloaded file. Browsers keep the usual download; the Android app hands it to the share
 * sheet. The plugins are imported only inside the app, so browsers never run them.
 * 保存下载的文件。浏览器照常下载；安卓 App 交给系统分享面板。插件只在 App 内导入，浏览器不会运行它们。
 */
export async function saveFile(blob: Blob, fileName: string, mimeType?: string): Promise<SaveResult> {
  const typed = !blob.type && mimeType ? new Blob([blob], { type: mimeType }) : blob;
  if (!isNativeApp()) {
    downloadInBrowser(typed, fileName);
    return 'saved';
  }
  return shareFromApp(typed, safeFileName(fileName, mimeType || typed.type));
}
