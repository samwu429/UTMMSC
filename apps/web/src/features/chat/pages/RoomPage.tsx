import { useParams } from 'react-router-dom';
import { RoomScreen } from '../room/RoomScreen';

/**
 * Full-screen room outside the tab shell. The screen is keyed by room, so every ref, the socket and the
 * scroll position start fresh when the member moves to another room.
 * 独立于标签外壳的全屏房间。房间页按房间区分实例，成员切换到另一个房间时，所有引用、连接和滚动位置都会重新开始。
 */
export function RoomPage() {
  const { roomId = '' } = useParams();
  return <RoomScreen key={roomId} roomId={roomId} />;
}
