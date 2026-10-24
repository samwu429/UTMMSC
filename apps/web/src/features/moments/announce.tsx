import { useEffect, useState } from 'react';

/**
 * Spoken feedback for 好友动态: 已赞, 已取消赞, 评论已发送, 评论发送失败, 已发表, 发送失败, 已刷新, 已删除. Call announce() with
 * text already passed through tr(); a page that wants it heard mounts MomentsLiveRegion once.
 * 好友动态的读屏播报：已赞、已取消赞、评论已发送、评论发送失败、已发表、发送失败、已刷新、已删除。调用 announce() 时传入已经过 tr()
 * 的文字；需要播报的页面挂载一次 MomentsLiveRegion。
 */

/** The region is emptied after this, so it never holds stale text. */
/** 播报区域在此之后清空，不会留下过时的文字。 */
const CLEAR_AFTER_MS = 4000;
/**
 * The text is written a moment after the region is emptied, so the same words twice in a row, such as 已赞 after
 * 已取消赞 after 已赞, are read again instead of being skipped as unchanged.
 * 文字在区域清空片刻之后才写入，因此连续两次相同的内容（例如 已赞、已取消赞、已赞）会再次播报，而不会因为没有变化被跳过。
 */
const WRITE_DELAY_MS = 50;

type Listener = (text: string) => void;

const listeners = new Set<Listener>();

/**
 * Reads `text` to screen readers through the mounted region. Nothing happens when no region is mounted, so a
 * message is never read late on another screen.
 * 通过已挂载的播报区域向读屏软件读出 `text`。没有挂载区域时不做任何事，因此消息不会在别的页面上迟到播报。
 */
export function announce(text: string): void {
  if (!text) return;
  for (const listener of listeners) listener(text);
}

/** Polite, visually hidden live region. Mount one per page. */
/** 礼貌模式、视觉上隐藏的播报区域。每个页面挂载一个。 */
export function MomentsLiveRegion() {
  const [text, setText] = useState('');

  useEffect(() => {
    let writeTimer: ReturnType<typeof setTimeout> | null = null;
    let clearTimer: ReturnType<typeof setTimeout> | null = null;
    const listener: Listener = (next) => {
      if (writeTimer) clearTimeout(writeTimer);
      if (clearTimer) clearTimeout(clearTimer);
      setText('');
      writeTimer = setTimeout(() => {
        writeTimer = null;
        setText(next);
        clearTimer = setTimeout(() => {
          clearTimer = null;
          setText('');
        }, CLEAR_AFTER_MS);
      }, WRITE_DELAY_MS);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (writeTimer) clearTimeout(writeTimer);
      if (clearTimer) clearTimeout(clearTimer);
    };
  }, []);

  return (
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {text}
    </div>
  );
}
