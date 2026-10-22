import { MemberAvatar } from '../../profile/InitialAvatar';
import { conversationInitial, type ConversationAvatar } from './conversations';

const SIZES = {
  48: 'h-12 w-12 text-[20px]',
  40: 'h-10 w-10 text-[17px]',
} as const;

/**
 * Square conversation avatar: channels get a brand tile with the first character of the name,
 * direct messages get the peer's photo or initial.
 * 方形会话头像：频道用品牌色底加名称首字，私聊用对方的头像或首字。
 */
export function ChatAvatar({ avatar, size = 48 }: { avatar: ConversationAvatar; size?: keyof typeof SIZES }) {
  if (avatar.kind === 'direct') {
    return <MemberAvatar name={avatar.name} avatarKey={avatar.avatarKey} shape="square" className={SIZES[size]} />;
  }
  return (
    <div aria-hidden className={`flex shrink-0 items-center justify-center rounded-[4px] bg-brand-700 font-medium text-white ${SIZES[size]}`}>
      {conversationInitial(avatar.name)}
    </div>
  );
}
