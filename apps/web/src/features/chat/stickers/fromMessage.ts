import type { ApiError, NormalizedChatMessage } from '@utmmsc/shared';
import { holdAppUpdate } from '../../../app/pwa';
import { ApiClientError, errorMessage } from '../../../shared/api/errors';
import { tr as currentTr } from '../../../shared/i18n/locale';
import { chatApi } from '../api';
import type { Translate } from '../format/systemText';
import { stickerAutoplays } from './media';
import { useStickerLibrary, type StickerAddOutcome } from './store';

/**
 * Adding to 我的表情 from a chat message, and what the toasts say about it. A sticker message adds its sticker with
 * the still the member just saw (one D1 row, no upload); a photo message is fetched and prepared like an album pick.
 * 从聊天消息添加到「我的表情」，以及相应提示的文字。表情消息以成员刚刚看到的静态图添加该表情（一行 D1 记录，不上传）；
 * 图片消息则先下载，再像从相册选择一样处理。
 */

/** The defensive refusal for a row that offers nothing to add. */
/** 对没有可添加内容的消息的防御性拒绝。 */
function notAddable(): StickerAddOutcome {
  return { kind: 'failed', message: currentTr('这条消息不能添加到表情', "This message can't be added to stickers.") };
}

/** A failed media response as the API client would read it: the server's message, or the generic status text. */
/** 与接口客户端相同的方式解读失败的媒体响应：服务端的提示，或通用的状态文字。 */
async function responseError(response: Response): Promise<ApiClientError> {
  let code = 'http_error';
  let message = `请求失败（${response.status}）`;
  if ((response.headers.get('content-type') ?? '').includes('application/json')) {
    const data = (await response.json().catch(() => ({}))) as Partial<ApiError>;
    code = data.error?.code ?? code;
    message = data.error?.message ?? message;
  }
  return new ApiClientError(response.status, code, message);
}

/**
 * Fetches a chat photo with the room's media token and adds it as an uploaded sticker. The blob's declared type is
 * ignored: preparation decides by the bytes. While it downloads the photo lives only in this page's memory, so this
 * holds back a waiting app update until its tile shows; the sticker store holds from then on.
 * 用房间的媒体令牌下载一张聊天图片，并作为上传的表情添加。忽略 blob 声明的类型：处理时由字节决定。下载期间图片只保存在本页面的内存中，
 * 因此在它的图块出现之前由这里推迟等待中的应用更新；之后由表情 store 接着推迟。
 */
export async function addStickerFromImage(imageKey: string, roomMediaToken: string | null): Promise<StickerAddOutcome> {
  if (!imageKey || !roomMediaToken) return notAddable();
  const release = holdAppUpdate();
  let adding: Promise<StickerAddOutcome[]>;
  try {
    const response = await fetch(chatApi.mediaUrl(imageKey, roomMediaToken));
    if (!response.ok) return { kind: 'failed', message: errorMessage(await responseError(response)) };
    const blob = await response.blob();
    // The tile shows, and holds, before this hold goes, so no moment is left without one.
    // 图块先出现并占用，这里的占用才释放，中间不留空档。
    adding = useStickerLibrary.getState().addFiles([blob]);
  } catch (error) {
    return { kind: 'failed', message: errorMessage(error) };
  } finally {
    release();
  }
  const [outcome] = await adding;
  return outcome ?? notAddable();
}

/**
 * 添加到表情 on a message: a sticker row adds its sticker, a photo row its photo; anything else is refused.
 * 消息上的「添加到表情」：表情消息添加它的表情，图片消息添加它的图片；其他消息一律拒绝。
 */
export function addStickerFromMessage(message: NormalizedChatMessage, roomMediaToken: string | null): Promise<StickerAddOutcome> {
  if (message.kind !== 'user' || message.deleted || message.recalled) return Promise.resolve(notAddable());
  if (message.sticker) return useStickerLibrary.getState().addSticker(message.sticker);
  if (message.imageKey) return addStickerFromImage(message.imageKey, roomMediaToken);
  return Promise.resolve(notAddable());
}

/** Whether an added sticker is animated but too large to play by itself in chats, whatever this device's settings. */
/** 添加的表情是否为动图但太大，无法在聊天中自动播放，与本设备的设置无关。 */
function playsOnlyWhenTapped(outcome: StickerAddOutcome): boolean {
  return outcome.kind === 'added' && outcome.sticker.animated && !stickerAutoplays(outcome.sticker, { reducedMotion: false, saveData: false });
}

function largeAnimationText(tr: Translate): string {
  return tr('已添加，这个动图较大，聊天中需点按播放', "Added. It's a large animation, so in chats it plays when tapped.");
}

/** The toast after adding one sticker: M3, M3b for a large animation, M4 for a repeat, or the refusal. */
/** 添加一个表情后的提示：M3；较大的动图为 M3b；重复添加为 M4；或者拒绝的原因。 */
export function stickerOutcomeText(outcome: StickerAddOutcome, tr: Translate): string {
  switch (outcome.kind) {
    case 'added':
      return playsOnlyWhenTapped(outcome) ? largeAnimationText(tr) : tr('已添加到表情', 'Added to stickers');
    case 'duplicate':
      return tr('已有这个表情，已移到最前', 'Already added. Moved to the front.');
    case 'limit':
    case 'failed':
      return outcome.message;
  }
}

/**
 * The toast right after a pick is prepared: how many files were not added and the most common reason, or null when
 * every file can go.
 * 一次选择处理完毕后立即显示的提示：有几个文件未添加，以及最常见的原因；所有文件都能上传时为 null。
 */
export function stickerPrepToast(problems: readonly string[], tr: Translate): string | null {
  if (problems.length === 0) return null;
  const counts = new Map<string, number>();
  let reason = problems[0] ?? '';
  for (const problem of problems) {
    const count = (counts.get(problem) ?? 0) + 1;
    counts.set(problem, count);
    if (count > (counts.get(reason) ?? 0)) reason = problem;
  }
  const n = problems.length;
  return tr(`${n} 个未添加：${reason}`, `${n} not added: ${reason}`);
}

/**
 * The toast once a pick's uploads end: the limit that stopped it (once), else M3b when an added sticker is a large
 * animation, else nothing (the tiles showed the rest).
 * 一次选择的上传全部结束后的提示：使其停止的上限（只说一次）；否则当添加的表情中有较大的动图时为 M3b；否则不提示（其余情况图块已经显示）。
 */
export function stickerBatchToast(outcomes: readonly StickerAddOutcome[], tr: Translate): string | null {
  for (const outcome of outcomes) if (outcome.kind === 'limit') return outcome.message;
  return outcomes.some(playsOnlyWhenTapped) ? largeAnimationText(tr) : null;
}
