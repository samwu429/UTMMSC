import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { MOMENT_IMAGE_LIMIT, MOMENT_IMAGE_MAX_BYTES, MOMENT_IMAGE_TYPES, MOMENT_VIDEO_MAX_BYTES, MOMENT_VIDEO_TYPES, POST_MAX, type ActivityPost } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { useSessionStore } from '../../../shared/session/store';
import { Button } from '../../../shared/ui/Button';
import { Notice, Spinner } from '../../../shared/ui/Card';
import { MemberAvatar } from '../../profile/InitialAvatar';
import { profileApi } from '../../profile/api';
import { formatPostTime } from '../../profile/format';
import { PostMediaView } from '../../profile/PostMediaView';

function MomentBody({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 140;
  return (
    <div className="mt-1">
      <p className={`whitespace-pre-wrap break-words text-[15px] leading-relaxed text-stone-800 ${long && !open ? 'line-clamp-6' : ''}`}>{text}</p>
      {long ? (
        <button type="button" className="mt-1 text-[15px] text-brand-700" onClick={() => setOpen((value) => !value)}>
          {open ? '收起' : '全文'}
        </button>
      ) : null}
    </div>
  );
}

function Moment({ post, mine, onDelete }: { post: ActivityPost; mine: boolean; onDelete: () => void }) {
  const [menu, setMenu] = useState(false);
  return (
    <article className="flex gap-3 px-4 py-3">
      <Link to={`/directory/${post.authorId}`} className="shrink-0">
        <MemberAvatar name={post.authorName} avatarKey={post.authorAvatarKey} className="h-10 w-10 text-sm" />
      </Link>
      <div className="min-w-0 flex-1">
        <Link to={`/directory/${post.authorId}`} className="text-[15px] font-medium text-brand-800">
          {post.authorName}
        </Link>
        {post.body ? <MomentBody text={post.body} /> : null}
        <PostMediaView media={post.media ?? []} />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs text-stone-400">{formatPostTime(post.createdAt)}</span>
          {mine ? (
            <div className="flex items-center gap-2">
              {menu ? (
                <button type="button" onClick={onDelete} className="rounded bg-brand-900 px-3 py-1.5 text-xs text-white">
                  删除
                </button>
              ) : null}
              <button type="button" aria-label="更多" onClick={() => setMenu((value) => !value)} className="flex h-8 items-center rounded bg-stone-200/80 px-2 text-xs tracking-widest text-stone-600">
                ···
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

interface DraftMedia {
  file: File;
  url: string;
  kind: 'image' | 'video';
}

function Composer({ onCancel, onPosted }: { onCancel: () => void; onPosted: (post: ActivityPost) => void }) {
  const [text, setText] = useState('');
  const [draft, setDraft] = useState<DraftMedia[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const imageRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const ready = (text.trim().length > 0 || draft.length > 0) && !busy;

  function clearDraft(next: DraftMedia[] = []) {
    for (const item of draft) URL.revokeObjectURL(item.url);
    setDraft(next);
  }

  function addImages(list: FileList | null) {
    if (!list || busy) return;
    const files = [...list].filter((file) => (MOMENT_IMAGE_TYPES as readonly string[]).includes(file.type));
    if (files.length < list.length) {
      setError('照片只支持 JPEG、PNG、WebP、GIF');
      return;
    }
    if (files.some((file) => file.size > MOMENT_IMAGE_MAX_BYTES)) {
      setError('照片不能超过 8MB');
      return;
    }
    const room = MOMENT_IMAGE_LIMIT - (draft[0]?.kind === 'video' ? 0 : draft.length);
    const picked = files.slice(0, Math.max(room, 0));
    if (files.length > picked.length) setError(`最多 ${MOMENT_IMAGE_LIMIT} 张照片`);
    else setError(null);
    const images = picked.map((file) => ({ file, url: URL.createObjectURL(file), kind: 'image' as const }));
    if (draft[0]?.kind === 'video') clearDraft(images);
    else setDraft((prev) => [...prev, ...images]);
  }

  function addVideo(list: FileList | null) {
    const file = list?.[0];
    if (!file || busy) return;
    if (!(MOMENT_VIDEO_TYPES as readonly string[]).includes(file.type)) {
      setError('视频只支持 MP4、MOV、WebM');
      return;
    }
    if (file.size > MOMENT_VIDEO_MAX_BYTES) {
      setError('视频不能超过 25MB');
      return;
    }
    setError(null);
    clearDraft([{ file, url: URL.createObjectURL(file), kind: 'video' }]);
  }

  function removeAt(index: number) {
    setDraft((prev) => {
      const target = prev[index];
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((_, itemIndex) => itemIndex !== index);
    });
  }

  async function publish() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    const uploaded: { key: string; contentType: string }[] = [];
    try {
      for (const item of draft) {
        const media = await profileApi.uploadMedia(item.file);
        uploaded.push({ key: media.key, contentType: media.contentType });
      }
      const res = await profileApi.addPost({ text: text.trim(), media: uploaded });
      for (const item of draft) URL.revokeObjectURL(item.url);
      onPosted(res.post);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="-mb-28 min-h-[100dvh] bg-white">
      <div className="flex items-center justify-between border-b border-stone-200 px-4">
        <button type="button" onClick={onCancel} className="min-h-11 text-[16px] text-stone-600">
          取消
        </button>
        <Button type="button" disabled={!ready} loading={busy} onClick={() => void publish()} className="min-h-9 px-4 py-1.5">
          发表
        </Button>
      </div>
      <textarea
        value={text}
        maxLength={POST_MAX}
        placeholder="这一刻的想法…"
        className="min-h-40 w-full resize-none bg-white px-4 py-4 text-[16px] leading-relaxed text-stone-900 outline-none placeholder:text-stone-400"
        onChange={(event) => setText(event.target.value)}
      />
      {draft.length > 0 ? (
        <div className="flex flex-wrap gap-2 px-4">
          {draft.map((item, index) => (
            <div key={item.url} className="relative h-20 w-20 overflow-hidden rounded bg-stone-100">
              {item.kind === 'image' ? <img src={item.url} alt="" className="h-full w-full object-cover" /> : <video src={item.url} className="h-full w-full object-cover" muted />}
              <button type="button" onClick={() => removeAt(index)} className="absolute right-0 top-0 bg-black/60 px-1.5 text-xs text-white" aria-label="移除">
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="flex gap-2 px-4 py-3">
        <button type="button" disabled={busy} onClick={() => imageRef.current?.click()} className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-paper text-[15px] font-medium text-brand-800 disabled:text-stone-300">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
            <rect x="4" y="5" width="16" height="14" rx="2" />
            <circle cx="9" cy="10" r="1.4" />
            <path d="m4 16 4.5-4 3.2 3.2L15 12l5 4" />
          </svg>
          照片
        </button>
        <button type="button" disabled={busy} onClick={() => videoRef.current?.click()} className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-paper text-[15px] font-medium text-brand-800 disabled:text-stone-300">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
            <rect x="3.5" y="6" width="12" height="12" rx="2" />
            <path d="m15.5 10.5 5-2.5v8l-5-2.5v-3Z" />
          </svg>
          视频
        </button>
      </div>
      <input ref={imageRef} type="file" accept={MOMENT_IMAGE_TYPES.join(',')} multiple className="hidden" onChange={(event) => { addImages(event.target.files); event.target.value = ''; }} />
      <input ref={videoRef} type="file" accept={MOMENT_VIDEO_TYPES.join(',')} className="hidden" onChange={(event) => { addVideo(event.target.files); event.target.value = ''; }} />
      {text.length > 400 ? <p className="px-4 text-xs text-stone-400">{text.length}/{POST_MAX}</p> : null}
      {error ? <div className="px-4"><Notice tone="error">{error}</Notice></div> : null}
    </div>
  );
}

export function ActivityPanel({ onOpenProfile, onPushed }: { onOpenProfile: () => void; onPushed: (pushed: boolean) => void }) {
  const self = useSessionStore((s) => s.member);
  const setMediaToken = useSessionStore((s) => s.setMediaToken);
  const [posts, setPosts] = useState<ActivityPost[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);

  useEffect(() => {
    onPushed(composing);
  }, [composing, onPushed]);

  useEffect(() => {
    let cancelled = false;
    profileApi
      .feed()
      .then((res) => {
        if (cancelled) return;
        setPosts(res.posts);
        setMediaToken(res.mediaToken);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [setMediaToken]);

  async function remove(id: string) {
    setError(null);
    try {
      await profileApi.removePost(id);
      setPosts((prev) => (prev ?? []).filter((post) => post.id !== id));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  if (composing) {
    return (
      <Composer
        onCancel={() => setComposing(false)}
        onPosted={(post) => {
          setPosts((prev) => [post, ...(prev ?? [])]);
          setComposing(false);
        }}
      />
    );
  }

  return (
    <div>
      <div className="relative h-48 bg-brand-800">
        <div className="h-1 bg-gold" />
        <button type="button" onClick={() => setComposing(true)} className="absolute right-3 top-3 min-h-10 rounded-full border-t-[3px] border-gold bg-white px-4 text-[15px] font-medium text-brand-800">
          发表
        </button>
        {self ? <p className="absolute bottom-6 right-28 left-4 truncate text-right text-[18px] font-medium text-white">{self.displayName}</p> : null}
        {self ? (
          <button type="button" onClick={onOpenProfile} className="absolute -bottom-8 right-4" aria-label="我的资料">
            <MemberAvatar name={self.displayName} avatarKey={self.avatarKey} className="h-16 w-16 text-xl ring-4 ring-paper" />
          </button>
        ) : null}
      </div>
      <div className="h-12" />
      <button type="button" onClick={() => setComposing(true)} className="mx-4 flex w-[calc(100%-2rem)] items-center gap-3 rounded-xl bg-white px-3 py-3 text-left ring-1 ring-stone-200 active:bg-stone-50">
        {self ? <MemberAvatar name={self.displayName} avatarKey={self.avatarKey} className="h-10 w-10 text-sm" /> : null}
        <span className="text-[15px] text-stone-400">这一刻的想法…</span>
      </button>
      {error ? <div className="px-4 pb-3 pt-3"><Notice tone="error">{error}</Notice></div> : null}
      {posts === null && !error ? <Spinner /> : null}
      {posts && posts.length === 0 ? (
        <div className="px-4 py-10 text-center">
          <p className="text-sm text-stone-400">还没有动态</p>
          <Button type="button" className="mt-4" onClick={() => setComposing(true)}>
            发表第一条
          </Button>
        </div>
      ) : null}
      {posts && posts.length > 0 ? (
        <div>
          {posts.map((post) => (
            <Moment key={post.id} post={post} mine={post.authorId === self?.id} onDelete={() => void remove(post.id)} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
