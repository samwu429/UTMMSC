import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { closeNotificationsFor } from '../../notifications/notifications';
import { RoomScreen } from '../room/RoomScreen';

/** Notices for a chat are cleared once it is on screen, as they are in WeChat. */
/** 聊天出现在屏幕上后，清掉它的通知，与微信一致。 */
function useClearRoomNotifications(roomId: string) {
  useEffect(() => {
    if (!roomId) return;
    closeNotificationsFor(roomId);
    const onVisible = () => {
      if (document.visibilityState === 'visible') closeNotificationsFor(roomId);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [roomId]);
}

/**
 * Full-screen room outside the tab shell. The screen is keyed by room, so every ref, the socket and the
 * scroll position start fresh when the member moves to another room.
 * 独立于标签外壳的全屏房间。房间页按房间区分实例，成员切换到另一个房间时，所有引用、连接和滚动位置都会重新开始。
 */
export function RoomPage() {
  const { roomId = '' } = useParams();
  useClearRoomNotifications(roomId);
  return <RoomScreen key={roomId} roomId={roomId} />;
}
