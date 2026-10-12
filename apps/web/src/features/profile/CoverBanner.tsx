import { useRef, useState, type ReactNode } from 'react';
import type { MemberSelf } from '@utmmsc/shared';
import { errorMessage } from '../../shared/api/errors';
import { useSessionStore } from '../../shared/session/store';
import { Button } from '../../shared/ui/Button';
import { Notice } from '../../shared/ui/Card';
import { profileApi } from './api';
import { coverImageSrc } from './media';
import { Sheet } from './Sheet';

export function CoverBanner({
  coverKey,
  tall = false,
  editable = false,
  onSaved,
  children,
}: {
  coverKey?: string | null;
  tall?: boolean;
  editable?: boolean;
  onSaved?: (member: MemberSelf) => void;
  children?: ReactNode;
}) {
  const token = useSessionStore((s) => s.mediaToken);
  const setMember = useSessionStore((s) => s.setMember);
  const setMediaToken = useSessionStore((s) => s.setMediaToken);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const src = coverImageSrc(coverKey, token);

  function saved(member: MemberSelf, mediaToken?: string) {
    setMember(member);
    if (mediaToken) setMediaToken(mediaToken);
    onSaved?.(member);
    setOpen(false);
  }

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const res = await profileApi.uploadCover(file);
      saved(res.member, res.mediaToken);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function clear() {
    setBusy(true);
    setError(null);
    try {
      const res = await profileApi.removeCover();
      saved(res.member);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`relative bg-brand-800 ${tall ? 'h-48' : 'h-32'}`}>
      <div className="relative z-10 h-1 bg-gold" />
      {src ? <img src={src} alt="" className="absolute inset-0 h-full w-full object-cover" /> : null}
      {src ? <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/45 to-transparent" /> : null}
      {children}
      {editable ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`absolute z-10 inline-flex min-h-9 items-center rounded-full bg-black/40 px-3 text-sm font-medium text-white ${tall ? 'left-3 top-3' : 'right-3 top-3'}`}
        >
          换封面
        </button>
      ) : null}
      {open ? (
        <Sheet title="封面" onClose={() => setOpen(false)}>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          <div className="space-y-3">
            <p className="text-sm leading-relaxed text-stone-500">这张图会同时用在资料页和动态页的顶部。</p>
            {error ? <Notice tone="error">{error}</Notice> : null}
            <Button block onClick={() => inputRef.current?.click()} loading={busy}>
              选择照片
            </Button>
            {coverKey ? (
              <Button block variant="secondary" disabled={busy} onClick={() => void clear()}>
                恢复默认
              </Button>
            ) : null}
          </div>
        </Sheet>
      ) : null}
    </div>
  );
}
