import { describe, expect, it } from 'vitest';
import { normalizeChatMessage, redactChatMessage, type ChatMessage, type NormalizedChatMessage, type StickerRef } from '@utmmsc/shared';
import { contextMenuOpensSave, stickerViewLive, type StickerView } from './stickerPreview';

const STICKER: StickerRef = {
  id: 'stk_0123456789abcdefghijkl',
  type: 'gif',
  width: 240,
  height: 240,
  animated: true,
  bytes: 182_044,
  thumb: 'AbCdEfGhIjKlMnOpQrStUv',
};

const VIEW: StickerView = { id: 7, sticker: STICKER };

function row(id: number, extra: Partial<ChatMessage> = {}): NormalizedChatMessage {
  return normalizeChatMessage({
    id,
    roomId: 'channel:ch_test',
    author: { id: 'mem_b', displayName: 'Bob' },
    text: '',
    imageKey: `chat/channel/ch_test/${STICKER.id}.gif`,
    imageWidth: 240,
    imageHeight: 240,
    createdAt: '2026-10-22T10:00:00.000Z',
    deleted: false,
    recalled: false,
    sticker: STICKER,
    ...extra,
  });
}

describe('stickerViewLive', () => {
  it('keeps the preview while its message is a live sticker row', () => {
    expect(stickerViewLive([row(6, { sticker: null, text: 'hi', imageKey: null }), row(7), row(8)], VIEW)).toBe(true);
  });

  it('closes it when the author recalls the message', () => {
    expect(stickerViewLive([row(7, { recalled: true })], VIEW)).toBe(false);
    // As the message store keeps it: flagged, then cleared.
    // 与消息存储保存的形式一致：先标记，再清空。
    expect(stickerViewLive([redactChatMessage(row(7, { recalled: true }))], VIEW)).toBe(false);
  });

  it('closes it when a moderator or the author removes the message', () => {
    expect(stickerViewLive([row(7, { deleted: true, deletedBy: 'moderator' })], VIEW)).toBe(false);
    expect(stickerViewLive([redactChatMessage(row(7, { deleted: true, deletedBy: 'author' }))], VIEW)).toBe(false);
  });

  it('closes it when the row is hidden or trimmed away', () => {
    expect(stickerViewLive([row(6), row(8)], VIEW)).toBe(false);
    expect(stickerViewLive([], VIEW)).toBe(false);
  });

  it('closes it when the row no longer shows that sticker', () => {
    expect(stickerViewLive([row(7, { sticker: null, text: '[表情]', imageKey: null })], VIEW)).toBe(false);
    expect(stickerViewLive([row(7, { sticker: { ...STICKER, id: 'stk_zyxwvutsrqponmlkjihgfe' } })], VIEW)).toBe(false);
  });

  it('never matches a system row with the same id', () => {
    expect(stickerViewLive([row(7, { kind: 'system', text: 'Ann joined' })], VIEW)).toBe(false);
  });
});

describe('contextMenuOpensSave', () => {
  const base = { sheetOpen: false, inside: true };

  it('opens 保存图片 from the keyboard on any control, actions included', () => {
    // A context menu from the keyboard names no pointer: an empty pointerType, or none on a plain MouseEvent.
    // 键盘触发的上下文菜单不指明指针：pointerType 为空，或在普通 MouseEvent 上根本没有。
    expect(contextMenuOpensSave({ ...base, pointerType: '' })).toBe(true);
    expect(contextMenuOpensSave({ ...base, pointerType: undefined })).toBe(true);
  });

  it('opens it on a right-click', () => {
    expect(contextMenuOpensSave({ ...base, pointerType: 'mouse' })).toBe(true);
  });

  it('leaves a finger or pen to the long press on the sticker', () => {
    expect(contextMenuOpensSave({ ...base, pointerType: 'touch' })).toBe(false);
    expect(contextMenuOpensSave({ ...base, pointerType: 'pen' })).toBe(false);
  });

  it('does nothing while the sheet is open or for events from the sheet', () => {
    expect(contextMenuOpensSave({ sheetOpen: true, inside: true, pointerType: '' })).toBe(false);
    expect(contextMenuOpensSave({ sheetOpen: false, inside: false, pointerType: '' })).toBe(false);
  });
});
