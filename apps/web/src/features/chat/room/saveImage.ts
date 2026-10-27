import { extensionForMime } from '../../../shared/native/fileName';
import { saveFile } from '../../../shared/native/native';
import { toast } from '../../../shared/ui/toast';
import type { Translate } from '../format/systemText';

/**
 * 保存图片 for the photo viewer and the sticker preview: downloads the full file as it is stored (a GIF stays animated)
 * and saves it under `baseName` with the extension of its type. A failure is toasted.
 * 图片查看器和表情预览的「保存图片」：按存储的原样下载完整文件（GIF 仍是动图），以 `baseName` 加上对应类型的扩展名保存。失败时弹出提示。
 */
export async function saveImageFromUrl(src: string, baseName: string, tr: Translate): Promise<void> {
  try {
    const res = await fetch(src);
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    await saveFile(blob, `${baseName}.${extensionForMime(blob.type) ?? 'jpg'}`, blob.type || 'image/jpeg');
  } catch {
    toast(tr('保存失败', 'Couldn’t save the image'));
  }
}
