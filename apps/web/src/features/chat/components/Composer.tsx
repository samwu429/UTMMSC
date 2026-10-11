import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { CHAT_IMAGE_MAX_BYTES, CHAT_IMAGE_TYPES, MESSAGE_TEXT_MAX } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { chatApi } from '../api';

interface Props {
  roomId: string;
  disabled: boolean;
  placeholder?: string;
  onSend: (text: string, imageKey?: string) => void;
  onError: (message: string) => void;
}

export function Composer({ roomId, disabled, placeholder, onSend, onError }: Props) {
  const [text, setText] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function submit(e?: FormEvent) {
    e?.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText('');
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  async function pickImage(file: File) {
    if (!(CHAT_IMAGE_TYPES as readonly string[]).includes(file.type)) {
      onError('只支持 JPEG、PNG、WebP、GIF');
      return;
    }
    if (file.size > CHAT_IMAGE_MAX_BYTES) {
      onError('图片不能超过 8MB');
      return;
    }
    setUploading(true);
    try {
      const res = await chatApi.uploadImage(roomId, file);
      onSend(text.trim(), res.imageKey);
      setText('');
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <form onSubmit={submit} className="flex items-end gap-2 border-t-[3px] border-gold bg-paper px-3 py-2" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 8px)' }}>
      <input ref={fileRef} type="file" accept={CHAT_IMAGE_TYPES.join(',')} className="hidden" onChange={(e) => e.target.files?.[0] && pickImage(e.target.files[0])} />
      <button type="button" onClick={() => fileRef.current?.click()} disabled={disabled || uploading} className="mb-0.5 h-9 w-9 shrink-0 text-xl text-stone-500 disabled:opacity-40" aria-label="发送图片">
        {uploading ? '…' : '＋'}
      </button>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, MESSAGE_TEXT_MAX))}
        onKeyDown={onKeyDown}
        rows={1}
        disabled={disabled}
        placeholder={placeholder ?? (disabled ? '此频道不允许你发言' : '输入消息')}
        className="max-h-32 flex-1 resize-none rounded-2xl border border-stone-300 bg-white px-3 py-2 outline-none focus:border-brand-800 disabled:bg-stone-100"
      />
      <button type="submit" disabled={disabled || !text.trim()} className="mb-0.5 h-9 shrink-0 rounded-md bg-brand-800 px-3.5 text-sm font-medium text-white disabled:bg-stone-200 disabled:text-stone-400">
        发送
      </button>
    </form>
  );
}
