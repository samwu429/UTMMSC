import { useEffect, useRef, useState } from 'react';
import type { NormalizedChatMessage } from '@utmmsc/shared';
import { useLocaleStore } from '../../../shared/i18n/locale';
import { spokenPreview, translatorFor } from './timeline';

const MIN_GAP_MS = 2000;
/** The region is emptied after this, so it holds no message text longer than needed. */
/** 播报区域在此之后清空，不会比需要的更久地保留消息文字。 */
const CLEAR_AFTER_MS = 5000;

interface Spoken {
  id: number;
  text: string;
}

/**
 * Reads other people's new messages to screen readers as 「名字：内容」, only while the list is at the
 * bottom and at most once every 2 seconds. Older pages that load above are never read. A message that
 * is recalled before or after it is read is dropped from the region at once.
 * 以「名字：内容」向读屏软件播报别人的新消息，只在列表位于底部时播报，且每 2 秒最多一次。向上加载的更早消息
 * 不会播报。在播报前后被撤回的消息会立即从播报区域移除。
 */
export function LiveAnnouncer({ messages, meId, stuck }: { messages: readonly NormalizedChatMessage[]; meId: string; stuck: boolean }) {
  const locale = useLocaleStore((s) => s.locale);
  const [spoken, setSpoken] = useState<Spoken | null>(null);
  const newestRef = useRef<number | null>(null);
  const lastAt = useRef(0);
  const queued = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesRef = useRef(messages);

  useEffect(() => {
    messagesRef.current = messages;
  });

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (clearTimer.current) clearTimeout(clearTimer.current);
    },
    [],
  );

  useEffect(() => {
    const tr = translatorFor(locale);

    function speak(id: number) {
      const message = messagesRef.current.find((m) => m.id === id);
      const preview = message ? spokenPreview(message, tr) : '';
      if (!message || !preview) return;
      const name = message.author.displayName.trim() || tr('成员', 'Member');
      lastAt.current = Date.now();
      setSpoken({ id, text: tr(`${name}：${preview}`, `${name}: ${preview}`) });
      if (clearTimer.current) clearTimeout(clearTimer.current);
      clearTimer.current = setTimeout(() => setSpoken(null), CLEAR_AFTER_MS);
    }

    const newest = messages[messages.length - 1]?.id ?? null;
    const previous = newestRef.current;
    if (newest !== null) newestRef.current = Math.max(newest, previous ?? 0);
    if (previous === null || newest === null || newest <= previous || !stuck) return;
    const fresh = messages.filter((m) => m.id > previous && m.kind === 'user' && m.author.id !== meId && spokenPreview(m, tr) !== '');
    const last = fresh[fresh.length - 1];
    if (!last) return;
    const wait = lastAt.current + MIN_GAP_MS - Date.now();
    if (wait <= 0) {
      speak(last.id);
      return;
    }
    queued.current = last.id;
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      const id = queued.current;
      queued.current = null;
      if (id !== null) speak(id);
    }, wait);
  }, [messages, meId, stuck, locale]);

  // A withdrawn, removed or hidden message leaves the region, and the state, at once.
  // 被撤回、删除或隐藏的消息立即离开播报区域和状态。
  const current = spoken ? messages.find((m) => m.id === spoken.id) : undefined;
  const withdrawn = spoken !== null && (!current || current.recalled || current.deleted);
  const live = spoken && !withdrawn ? spoken.text : '';

  useEffect(() => {
    if (withdrawn) setSpoken(null);
  }, [withdrawn]);

  return (
    <div className="sr-only" role="log" aria-live="polite" aria-atomic="true">
      {live}
    </div>
  );
}
