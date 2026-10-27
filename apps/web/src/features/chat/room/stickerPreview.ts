import type { NormalizedChatMessage, StickerRef } from '@utmmsc/shared';

/**
 * Pure rules of the sticker tap preview (1.6): whether the message it shows is still there, and which context menus
 * open its 保存图片 sheet.
 * 表情点按预览（1.6）的纯规则：它显示的消息是否仍然存在，以及哪些上下文菜单会打开「保存图片」操作表。
 */

/** The preview on screen and the message it was opened from. */
/** 屏幕上的预览，以及打开它的那条消息。 */
export interface StickerView {
  id: number;
  sticker: StickerRef;
}

/**
 * The message the preview came from is still a live user row showing that sticker. A recall, a removal, a hide or a
 * trim takes it away, and the preview then closes, as the photo viewer does.
 * 预览来自的消息仍是显示该表情的有效用户消息。撤回、删除、隐藏或裁剪都会让它消失，预览随之关闭，与图片查看器一致。
 */
export function stickerViewLive(messages: readonly NormalizedChatMessage[], view: StickerView): boolean {
  return messages.some((m) => m.id === view.id && m.kind === 'user' && !m.recalled && !m.deleted && m.sticker?.id === view.sticker.id);
}

export interface PreviewContextMenu {
  /** The 保存图片 sheet is already open. */
  /** 「保存图片」操作表已经打开。 */
  sheetOpen: boolean;
  /** The event started inside the preview, not in the sheet, which reaches it only through React. */
  /** 事件发生在预览之内，而不是在只经 React 冒泡过来的操作表中。 */
  inside: boolean;
  /** The event's pointerType: empty or missing from the keyboard, 'mouse' for a right-click, 'touch' for a finger. */
  /** 事件的 pointerType：键盘触发时为空或不存在，右键为 'mouse'，手指为 'touch'。 */
  pointerType: string | undefined;
}

/**
 * A context menu in the preview opens 保存图片. The ContextMenu key and Shift+F10 fire it on the focused control,
 * an action included, so the keyboard reaches it from anywhere in the preview, as in the photo viewer; a right-click
 * does too. A finger or pen opens it only by the long press on the sticker, which handles its own context menu, so a
 * finger held on 发送 or 添加到表情 does not.
 * 预览中的上下文菜单会打开「保存图片」。ContextMenu 键和 Shift+F10 会在获得焦点的控件上触发它（包括操作按钮），
 * 因此键盘在预览的任何位置都能打开，与图片查看器相同；右键也一样。手指或触控笔只能通过长按表情打开（表情自己处理它的上下文菜单），
 * 因此在「发送」或「添加到表情」上按住手指不会打开。
 */
export function contextMenuOpensSave({ sheetOpen, inside, pointerType }: PreviewContextMenu): boolean {
  if (sheetOpen || !inside) return false;
  return pointerType !== 'touch' && pointerType !== 'pen';
}
