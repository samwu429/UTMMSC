import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NormalizedChatMessage, StickerItem } from '@utmmsc/shared';
import { appUpdateHolds } from '../../../app/pwa';
import { addStickerFromImage, addStickerFromMessage, stickerBatchToast, stickerOutcomeText, stickerPrepToast } from './fromMessage';
import { useStickerLibrary, type StickerAddOutcome } from './store';

const KIB = 1024;
const MIB = 1024 * KIB;
const zh = (z: string) => z;
const en = (_z: string, e: string) => e;

function sticker(overrides: Partial<StickerItem> = {}): StickerItem {
  return { id: `stk_${'a'.repeat(22)}`, type: 'gif', width: 240, height: 240, animated: true, bytes: 200 * KIB, thumb: 'S'.repeat(22), addedAt: '2026-10-26T00:00:00.000Z', ...overrides };
}

function message(overrides: Partial<NormalizedChatMessage> = {}): NormalizedChatMessage {
  return {
    id: 812,
    roomId: 'channel:abc',
    kind: 'user',
    author: { id: 'mem_b', displayName: 'Bob' } as NormalizedChatMessage['author'],
    text: '',
    imageKey: null,
    imageWidth: null,
    imageHeight: null,
    thumbKey: null,
    sticker: null,
    replyTo: null,
    system: null,
    createdAt: '2026-10-26T00:00:00.000Z',
    deleted: false,
    deletedBy: null,
    recalled: false,
    rev: 1,
    clientId: null,
    ...overrides,
  };
}

describe('addStickerFromMessage', () => {
  const original = useStickerLibrary.getState();
  const addSticker = vi.fn(async (ref: StickerItem | Parameters<typeof original.addSticker>[0]): Promise<StickerAddOutcome> => ({ kind: 'added', sticker: { ...ref, addedAt: 'now' } }));
  const addFiles = vi.fn(async (): Promise<StickerAddOutcome[]> => [{ kind: 'added', sticker: sticker({ id: `stk_${'p'.repeat(22)}` }) }]);

  beforeEach(() => {
    addSticker.mockClear();
    addFiles.mockClear();
    useStickerLibrary.setState({ addSticker, addFiles });
  });

  afterEach(() => {
    useStickerLibrary.setState({ addSticker: original.addSticker, addFiles: original.addFiles });
    vi.unstubAllGlobals();
  });

  it('adds a sticker message\'s sticker with the still the member saw, uploading nothing', async () => {
    const ref = { id: `stk_${'b'.repeat(22)}`, type: 'png' as const, width: 64, height: 64, animated: false, bytes: 900, thumb: 'Q'.repeat(22) };
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const outcome = await addStickerFromMessage(message({ sticker: ref }), 'room-token');
    expect(addSticker).toHaveBeenCalledWith(ref);
    expect(outcome.kind).toBe('added');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(addFiles).not.toHaveBeenCalled();
  });

  it('fetches a photo message with the room token and adds it as a pick', async () => {
    const photo = new Blob([Uint8Array.from([1, 2, 3])], { type: 'image/jpeg' });
    const fetchMock = vi.fn(async () => new Response(photo, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const outcome = await addStickerFromMessage(message({ imageKey: 'chat/channel/abc/img_0123456789abcdef.jpeg' }), 'room-token');
    expect(String((fetchMock.mock.calls[0] as unknown[] | undefined)?.[0])).toMatch(/\/chat\/media\/chat%2Fchannel%2Fabc%2Fimg_0123456789abcdef\.jpeg\?t=room-token$/);
    expect(addFiles).toHaveBeenCalledTimes(1);
    const [files] = addFiles.mock.calls[0] as unknown as [Blob[]];
    expect(files).toHaveLength(1);
    expect(outcome.kind).toBe('added');
    expect(addSticker).not.toHaveBeenCalled();
  });

  it('says why a photo could not be fetched', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'expired', message: '媒体链接已过期' } }), { status: 403, headers: { 'content-type': 'application/json' } })));
    expect(await addStickerFromImage('chat/channel/abc/img_0123456789abcdef.jpeg', 'old')).toEqual({ kind: 'failed', message: '媒体链接已过期' });
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))));
    expect(await addStickerFromImage('chat/channel/abc/img_0123456789abcdef.jpeg', 'tok')).toEqual({ kind: 'failed', message: '网络连接失败，请检查网络后重试' });
    expect(addFiles).not.toHaveBeenCalled();
  });

  it('holds back an app update while the photo downloads, until its tile shows', async () => {
    let answer: (response: Response) => void = () => undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            answer = resolve;
          }),
      ),
    );
    const heldAtAdd: boolean[] = [];
    addFiles.mockImplementationOnce(async () => {
      heldAtAdd.push(appUpdateHolds.held);
      return [{ kind: 'added', sticker: sticker() }];
    });
    expect(appUpdateHolds.held).toBe(false);
    const job = addStickerFromImage('chat/channel/abc/img_0123456789abcdef.jpeg', 'tok');
    expect(appUpdateHolds.held).toBe(true);
    answer(new Response(new Blob([Uint8Array.from([1, 2, 3])]), { status: 200 }));
    expect((await job).kind).toBe('added');
    // Still held when the pick starts, whose tile holds from then on; let go once it is handed over.
    // 选择开始时仍在占用，之后由它的图块占用；交接完成后释放。
    expect(heldAtAdd).toEqual([true]);
    expect(appUpdateHolds.held).toBe(false);

    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))));
    const failed = addStickerFromImage('chat/channel/abc/img_0123456789abcdef.jpeg', 'tok');
    expect(appUpdateHolds.held).toBe(true);
    expect((await failed).kind).toBe('failed');
    expect(appUpdateHolds.held).toBe(false);
  });

  it('refuses rows with nothing to add, and photos without a token', async () => {
    const refused = { kind: 'failed', message: '这条消息不能添加到表情' };
    expect(await addStickerFromMessage(message({ text: 'hi' }), 'tok')).toEqual(refused);
    expect(await addStickerFromMessage(message({ kind: 'system', sticker: sticker() }), 'tok')).toEqual(refused);
    expect(await addStickerFromMessage(message({ recalled: true, sticker: sticker() }), 'tok')).toEqual(refused);
    expect(await addStickerFromMessage(message({ imageKey: 'chat/channel/abc/img_0123456789abcdef.jpeg' }), null)).toEqual(refused);
    expect(addSticker).not.toHaveBeenCalled();
  });
});

describe('stickerOutcomeText', () => {
  it('says added, large animation, repeat, or the refusal', () => {
    expect(stickerOutcomeText({ kind: 'added', sticker: sticker() }, zh)).toBe('已添加到表情');
    expect(stickerOutcomeText({ kind: 'added', sticker: sticker() }, en)).toBe('Added to stickers');
    expect(stickerOutcomeText({ kind: 'added', sticker: sticker({ bytes: 3 * MIB }) }, zh)).toBe('已添加，这个动图较大，聊天中需点按播放');
    expect(stickerOutcomeText({ kind: 'added', sticker: sticker({ width: 800, height: 700 }) }, en)).toBe("Added. It's a large animation, so in chats it plays when tapped.");
    expect(stickerOutcomeText({ kind: 'added', sticker: sticker({ animated: false, bytes: 5 * MIB }) }, zh)).toBe('已添加到表情');
    expect(stickerOutcomeText({ kind: 'duplicate', sticker: sticker({ bytes: 3 * MIB }) }, zh)).toBe('已有这个表情，已移到最前');
    expect(stickerOutcomeText({ kind: 'duplicate', sticker: sticker() }, en)).toBe('Already added. Moved to the front.');
    expect(stickerOutcomeText({ kind: 'limit', message: '最多添加 999 个表情，请先删除一些' }, zh)).toBe('最多添加 999 个表情，请先删除一些');
    expect(stickerOutcomeText({ kind: 'failed', message: '这个表情已失效' }, zh)).toBe('这个表情已失效');
  });
});

describe('stickerPrepToast', () => {
  it('counts every file not added and names the most common reason', () => {
    expect(stickerPrepToast(['表情不能超过 8MB', '只支持 JPEG、PNG、WebP、GIF', '表情不能超过 8MB'], zh)).toBe('3 个未添加：表情不能超过 8MB');
    expect(stickerPrepToast(['A', 'B', 'B', 'A', 'C'], en)).toBe('5 not added: B');
    expect(stickerPrepToast(['A', 'B'], zh)).toBe('2 个未添加：A');
    expect(stickerPrepToast(['Stickers must be 8 MB or smaller.'], en)).toBe('1 not added: Stickers must be 8 MB or smaller.');
  });

  it('says nothing when every file can go', () => {
    expect(stickerPrepToast([], zh)).toBeNull();
  });
});

describe('stickerBatchToast', () => {
  it('names the limit once, before anything else', () => {
    const limit: StickerAddOutcome = { kind: 'limit', message: '今天上传的表情太多了，请明天再试' };
    expect(stickerBatchToast([{ kind: 'added', sticker: sticker({ bytes: 3 * MIB }) }, limit, limit], zh)).toBe('今天上传的表情太多了，请明天再试');
  });

  it('says M3b when an added sticker is a large animation, and nothing otherwise', () => {
    expect(stickerBatchToast([{ kind: 'added', sticker: sticker() }, { kind: 'added', sticker: sticker({ bytes: 3 * MIB }) }], zh)).toBe('已添加，这个动图较大，聊天中需点按播放');
    expect(stickerBatchToast([{ kind: 'added', sticker: sticker() }, { kind: 'duplicate', sticker: sticker({ bytes: 3 * MIB }) }], zh)).toBeNull();
    expect(stickerBatchToast([{ kind: 'failed', message: '网络连接失败，请检查网络后重试' }], zh)).toBeNull();
    expect(stickerBatchToast([], zh)).toBeNull();
  });
});
