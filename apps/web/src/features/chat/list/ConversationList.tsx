import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatOverviewResponse } from '@utmmsc/shared';
import { useLabels } from '../../../shared/i18n/locale';
import { useSessionStore } from '../../../shared/session/store';
import { useDraftsStore } from '../state/drafts';
import { ConversationRow } from './ConversationRow';
import { buildConversations, reuseConversations, type Conversation } from './conversations';

/** Current time, updated at the start of every minute so list times such as 14:32 stay right. */
/** 当前时间，每分钟开始时更新，使列表上的 14:32 这类时间保持准确。 */
export function useMinuteTick(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    const timeout = setTimeout(
      () => {
        setNow(Date.now());
        interval = setInterval(() => setNow(Date.now()), 60_000);
      },
      60_000 - (Date.now() % 60_000),
    );
    return () => {
      clearTimeout(timeout);
      if (interval) clearInterval(interval);
    };
  }, []);
  return now;
}

/** Rows for the merged list, rebuilt when the data, a draft, the language or the minute changes. */
/** 合并列表的各行；数据、草稿、语言或分钟变化时重新生成。 */
export function useConversationRows(data: ChatOverviewResponse | null): Conversation[] {
  const { tr, locale } = useLabels();
  const meId = useSessionStore((s) => s.member?.id ?? null);
  const drafts = useDraftsStore((s) => s.drafts);
  const now = useMinuteTick();
  const previous = useRef<Conversation[]>([]);
  return useMemo(() => {
    const next = reuseConversations(previous.current, buildConversations(data, drafts, meId, now, tr, locale));
    previous.current = next;
    return next;
    // tr is rebuilt on every render; locale is what it depends on.
    // tr 每次渲染都会重新创建；它真正依赖的是 locale。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, drafts, meId, now, locale]);
}

export function ConversationList({ rows, onOpen }: { rows: Conversation[]; onOpen: (roomId: string) => void }) {
  return (
    <ul className="-mx-4 bg-white">
      {rows.map((row, index) => (
        <li key={row.roomId}>
          <ConversationRow row={row} last={index === rows.length - 1} onOpen={onOpen} />
        </li>
      ))}
    </ul>
  );
}
