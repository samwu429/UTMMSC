import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { hasPermission, parseRoomId } from '@utmmsc/shared';
import { useSessionStore } from '../../../shared/session/store';
import { Notice } from '../../../shared/ui/Card';
import { Composer } from '../components/Composer';
import { MessageBubble } from '../components/MessageBubble';
import { useRoomSocket } from '../transport/useRoomSocket';

/**
 * Full-screen room view outside the tab shell. Scroll sticks to the bottom for new messages and
 * preserves position when older history is prepended.
 * 独立于标签外壳的全屏房间视图。新消息时滚动贴底，加载更早历史时保持原位置。
 */
export function RoomPage() {
  const { roomId = '' } = useParams();
  const navigate = useNavigate();
  const member = useSessionStore((s) => s.member);
  const room = useRoomSocket(roomId);
  const listRef = useRef<HTMLDivElement>(null);
  const [stickToBottom, setStickToBottom] = useState(true);
  const prevHeightRef = useRef(0);
  const prevFirstIdRef = useRef<number | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const parsed = parseRoomId(roomId);
  const canModerate = member ? hasPermission(member.role, 'chat.moderate') : false;
  const socketOpen = room.status === 'open';
  const blocked = room.canPost === false;

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const firstId = room.messages[0]?.id ?? null;
    const prepended = prevFirstIdRef.current !== null && firstId !== null && firstId < prevFirstIdRef.current;
    if (prepended) {
      list.scrollTop += list.scrollHeight - prevHeightRef.current;
    } else if (stickToBottom) {
      list.scrollTop = list.scrollHeight;
    }
    prevHeightRef.current = list.scrollHeight;
    prevFirstIdRef.current = firstId;
  }, [room.messages, stickToBottom]);

  useEffect(() => {
    const last = room.messages[room.messages.length - 1];
    if (last && last.id > room.lastReadId && document.visibilityState === 'visible') room.markRead(last.id);
  }, [room, room.messages, room.lastReadId]);

  function onScroll() {
    const list = listRef.current;
    if (!list) return;
    const distance = list.scrollHeight - list.scrollTop - list.clientHeight;
    setStickToBottom(distance < 80);
    if (list.scrollTop < 40 && room.hasMore) {
      prevHeightRef.current = list.scrollHeight;
      room.loadOlder();
    }
  }

  function mute(memberId: string) {
    const input = window.prompt('禁言多少分钟？', '60');
    const minutes = Number(input);
    if (Number.isInteger(minutes) && minutes > 0) room.mute(memberId, minutes);
  }

  const error = room.error ?? localError;
  const title = parsed?.kind === 'direct' ? '私聊' : '频道';

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col bg-[#efece6]">
      <header className="flex items-center gap-2 border-b border-stone-200 bg-[#f7f6f3] px-2 py-2">
        <button onClick={() => navigate('/chat')} className="h-10 w-10 rounded-full text-xl text-slate-600" aria-label="返回">
          ←
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{title}</p>
          <p className="text-xs text-slate-500">
            {socketOpen ? `${room.onlineCount} 人在线` : room.status === 'connecting' ? '连接中…' : room.retrying ? '已断开，正在重连' : '未连接'}
          </p>
        </div>
      </header>

      <div ref={listRef} onScroll={onScroll} className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {room.hasMore ? <p className="text-center text-xs text-slate-400">上拉加载更早的消息</p> : null}
        {room.messages.map((m) => (
          <MessageBubble
            key={m.id}
            message={m}
            own={m.author.id === member?.id}
            canModerate={canModerate}
            mediaToken={room.mediaToken}
            onDelete={room.remove}
            onMute={mute}
            onOpenProfile={(id) => navigate(`/directory/${id}`)}
          />
        ))}
      </div>

      {error ? (
        <div className="px-3 pb-2">
          <Notice tone="error">
            {error}{' '}
            <button
              onClick={() => {
                room.clearError();
                setLocalError(null);
              }}
              className="underline"
            >
              关闭
            </button>
          </Notice>
        </div>
      ) : null}

      <Composer
        roomId={roomId}
        disabled={!socketOpen || blocked}
        placeholder={blocked ? '此频道不允许你发言' : socketOpen ? '输入消息' : '连接中…'}
        onSend={room.send}
        onError={setLocalError}
      />
    </div>
  );
}
