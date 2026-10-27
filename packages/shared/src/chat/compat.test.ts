import { describe, expect, it } from 'vitest';
import { normalizeChatMessage, parseServerFrame } from './protocol';
import { STICKER_TEXT, stickerAliasKey, type StickerRef } from './stickers';
import * as old from './testing/protocol-ea765d6';

/**
 * Builds from ea765d6 keep running against a server that sends stickers. testing/protocol-ea765d6.ts is that commit's
 * protocol.ts byte for byte, so these tests run the parser those builds ship. A sticker row reaches them as a photo:
 * the alias image under the room's prefix, with its size, no thumbnail and empty text.
 * ea765d6 的版本在服务端发送表情后仍能正常运行。testing/protocol-ea765d6.ts 与该提交的 protocol.ts 逐字节相同，
 * 因此这些测试运行的正是这些版本所带的解析器。表情消息在它们那里显示为图片：房间前缀下的别名图片，带尺寸，没有缩略图，正文为空。
 */

const ROOM = 'channel:abc';
const sticker: StickerRef = { id: 'stk_0123456789abcdefghijkl', type: 'gif', width: 240, height: 240, animated: true, bytes: 182_044, thumb: 'AbCdEfGhIjKlMnOpQrStUv' };

/** A sticker row exactly as the room sends it (spec 4.1). */
/** 房间实际发送的表情消息（规格 4.1）。 */
const wireRow = {
  id: 812,
  roomId: ROOM,
  kind: 'user',
  author: { id: 'mem_a', displayName: '张三', avatarKey: null },
  text: '',
  imageKey: stickerAliasKey(ROOM, sticker),
  imageWidth: 240,
  imageHeight: 240,
  thumbKey: null,
  sticker,
  replyTo: null,
  createdAt: '2026-10-26T12:00:00.000Z',
  deleted: false,
  recalled: false,
  rev: 1203,
};

describe('old clients (ea765d6) and sticker rows', () => {
  it('read a sticker message as a valid photo row with the alias image', () => {
    const frame = old.parseServerFrame({ type: 'message', message: wireRow, clientId: 'c1' });
    if (frame?.type !== 'message') throw new Error('expected a message frame');
    const message = frame.message as old.NormalizedChatMessage;
    expect(message).toMatchObject({
      id: 812,
      kind: 'user',
      text: '',
      imageKey: 'chat/channel/abc/stk_0123456789abcdefghijkl.gif',
      imageWidth: 240,
      imageHeight: 240,
      thumbKey: null,
      deleted: false,
      recalled: false,
      rev: 1203,
    });
    // The extra field is dropped, so nothing in an old build ever sees it.
    // 多出的字段被丢弃，旧版本中的任何部分都看不到它。
    expect(message).not.toHaveProperty('sticker');
  });

  it('read the same row in history and catch-up frames', () => {
    const frame = old.parseServerFrame({ type: 'history_result', messages: [wireRow], hasMore: false, changed: [wireRow] });
    if (frame?.type !== 'history_result') throw new Error('expected a history frame');
    expect(frame.messages[0]).toMatchObject({ imageKey: wireRow.imageKey, imageWidth: 240, imageHeight: 240, thumbKey: null, text: '' });
    expect(frame.changed?.[0]?.imageKey).toBe(wireRow.imageKey);
    expect(old.normalizeChatMessage(wireRow as old.ChatMessage)).toMatchObject({ imageKey: wireRow.imageKey, text: '' });
  });

  it('read a quote of a sticker by its excerpt', () => {
    const reply = { ...wireRow, id: 813, sticker: undefined, imageKey: null, text: 'nice', replyTo: { id: 812, authorId: 'mem_a', authorName: '张三', excerpt: STICKER_TEXT, hasImage: false, state: 'ok', hasSticker: true } };
    const message = old.normalizeChatMessage(reply as old.ChatMessage);
    expect(message.replyTo).toEqual({ id: 812, authorId: 'mem_a', authorName: '张三', excerpt: '[表情]', hasImage: false, state: 'ok' });
  });

  it('still parse a ready frame that offers stickers', () => {
    const ready = { type: 'ready', roomId: ROOM, memberId: 'mem_a', lastReadId: 4, onlineCount: 0, rev: 7, visibility: true, stickers: true };
    expect(old.parseServerFrame(ready)).toMatchObject({ type: 'ready', rev: 7, visibility: true });
  });

  it('while new clients read the same row as a sticker without the alias', () => {
    const frame = parseServerFrame({ type: 'message', message: wireRow });
    if (frame?.type !== 'message') throw new Error('expected a message frame');
    expect(frame.message).toMatchObject({ sticker, imageKey: null, imageWidth: null, imageHeight: null, thumbKey: null, text: '' });
    expect(normalizeChatMessage(wireRow as never).sticker).toEqual(sticker);
  });
});
