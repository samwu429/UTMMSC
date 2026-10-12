import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { hasPermission, parseRoomId } from '@utmmsc/shared';
import { useSessionStore } from '../../../shared/session/store';
import { BackHeader } from '../../../shared/ui/BackHeader';
import { Button } from '../../../shared/ui/Button';
import { Notice } from '../../../shared/ui/Card';
import { Composer } from '../components/Composer';
import { MessageBubble } from '../components/MessageBubble';
import { Sheet } from '../../profile/Sheet';
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
  const [muteId, setMuteId] = useState<string | null>(null);

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

  function chooseMute(minutes: number) {
    if (!muteId) return;
    room.mute(muteId, minutes);
    setMuteId(null);
  }

  const error = room.error ?? localError;
  const title = parsed?.kind === 'direct' ? '私聊' : '频道';

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col bg-canvas">
      <BackHeader
        flush
        to="/chat"
        label="聊天"
        title={title}
        trailing={
          <span className="truncate text-xs text-stone-400">
            {socketOpen ? `${room.onlineCount} 人在线` : room.status === 'connecting' ? '连接中…' : room.retrying ? '重连中' : '未连接'}
          </span>
        }
      />

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
            onMute={setMuteId}
            onOpenProfile={(id) => navigate(`/directory/${id}`)}
          />
        ))}
      </div>

      {error ? (
        <div className="px-3 pb-2">
          <Notice tone="error">
            {error}{' '}
            <button
              type="button"
              onClick={() => {
                room.clearError();
                setLocalError(null);
              }}
              className="ml-2 inline-flex min-h-11 items-center font-medium"
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
      {muteId ? (
        <Sheet title="禁言时长" onClose={() => setMuteId(null)}>
          <div className="space-y-2">
            <Button block variant="secondary" onClick={() => chooseMute(10)}>
              10 分钟
            </Button>
            <Button block variant="secondary" onClick={() => chooseMute(60)}>
              1 小时
            </Button>
            <Button block variant="secondary" onClick={() => chooseMute(1440)}>
              1 天
            </Button>
          </div>
        </Sheet>
      ) : null}
    </div>
  );
}
