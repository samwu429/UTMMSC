import type { ChatMessage } from '@utmmsc/shared';
import { formatMessageTime } from '../../../shared/format/time';
import { chatApi } from '../api';

interface Props {
  message: ChatMessage;
  own: boolean;
  canModerate: boolean;
  mediaToken: string | null;
  onDelete: (id: number) => void;
  onMute: (memberId: string) => void;
  onOpenProfile: (memberId: string) => void;
}

export function MessageBubble({ message, own, canModerate, mediaToken, onDelete, onMute, onOpenProfile }: Props) {
  const canDelete = own || canModerate;
  return (
    <div className={`flex gap-2 ${own ? 'flex-row-reverse' : ''}`}>
      {!own ? (
        <button onClick={() => onOpenProfile(message.author.id)} className="mt-5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-800">
          {message.author.displayName.slice(0, 1)}
        </button>
      ) : null}
      <div className={`max-w-[78%] ${own ? 'items-end' : 'items-start'} flex flex-col`}>
        <div className={`mb-0.5 flex items-center gap-2 text-xs text-slate-500 ${own ? 'flex-row-reverse' : ''}`}>
          {!own ? <span>{message.author.displayName}</span> : null}
          <span>{formatMessageTime(message.createdAt)}</span>
        </div>
        <div className={`rounded-2xl px-3 py-2 ${own ? 'bg-brand-700 text-white' : 'bg-white text-slate-900 shadow-sm'} ${message.deleted ? 'italic opacity-60' : ''}`}>
          {message.deleted ? (
            <span className="text-sm">消息已删除</span>
          ) : (
            <>
              {message.imageKey && mediaToken ? (
                <img src={chatApi.mediaUrl(message.imageKey, mediaToken)} alt="" className="mb-1 max-h-72 rounded-lg" loading="lazy" />
              ) : null}
              {message.text ? <p className="whitespace-pre-wrap break-words text-[15px] leading-snug">{message.text}</p> : null}
            </>
          )}
        </div>
        {!message.deleted && (canDelete || (canModerate && !own)) ? (
          <div className="mt-0.5 flex gap-3 text-xs text-slate-400">
            {canDelete ? <button onClick={() => onDelete(message.id)}>删除</button> : null}
            {canModerate && !own ? <button onClick={() => onMute(message.author.id)}>禁言</button> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
