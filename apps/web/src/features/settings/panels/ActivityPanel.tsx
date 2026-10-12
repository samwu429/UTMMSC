import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { POST_MAX, type ActivityPost } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { useSessionStore } from '../../../shared/session/store';
import { Notice, Spinner } from '../../../shared/ui/Card';
import { InitialAvatar } from '../../profile/InitialAvatar';
import { PencilIcon } from '../../profile/icons';
import { profileApi } from '../../profile/api';
import { formatPostTime } from '../../profile/format';

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
        <InitialAvatar name={post.authorName} className="h-10 w-10 text-sm" />
      </Link>
      <div className="min-w-0 flex-1">
        <Link to={`/directory/${post.authorId}`} className="text-[15px] font-medium text-brand-800">
          {post.authorName}
        </Link>
        <MomentBody text={post.body} />
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

function Composer({ onCancel, onPosted }: { onCancel: () => void; onPosted: (post: ActivityPost) => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ready = text.trim().length > 0 && !busy;

  async function publish() {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await profileApi.addPost(body);
      onPosted(res.post);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="-mb-24 min-h-[100dvh] bg-white">
      <div className="flex items-center justify-between border-b border-stone-200 px-4">
        <button type="button" onClick={onCancel} className="min-h-11 text-[16px] text-stone-600">
          取消
        </button>
        <button type="button" disabled={!ready} onClick={() => void publish()} className={`min-h-11 text-[16px] font-medium ${ready ? 'text-brand-800' : 'text-stone-300'}`}>
          {busy ? '发表中' : '发表'}
        </button>
      </div>
      <textarea
        value={text}
        maxLength={POST_MAX}
        placeholder="这一刻的想法…"
        className="min-h-60 w-full resize-none bg-white px-4 py-4 text-[16px] leading-relaxed text-stone-900 outline-none placeholder:text-stone-400"
        onChange={(event) => setText(event.target.value)}
      />
      {text.length > 400 ? <p className="px-4 text-xs text-stone-400">{text.length}/{POST_MAX}</p> : null}
      {error ? <div className="px-4"><Notice tone="error">{error}</Notice></div> : null}
    </div>
  );
}

export function ActivityPanel({ onOpenProfile, onPushed }: { onOpenProfile: () => void; onPushed: (pushed: boolean) => void }) {
  const self = useSessionStore((s) => s.member);
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
        if (!cancelled) setPosts(res.posts);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
        <button type="button" aria-label="发表" onClick={() => setComposing(true)} className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center text-white">
          <PencilIcon />
        </button>
        {self ? <p className="absolute bottom-6 right-28 left-4 truncate text-right text-[18px] font-medium text-white">{self.displayName}</p> : null}
        {self ? (
          <button type="button" onClick={onOpenProfile} className="absolute -bottom-8 right-4" aria-label="我的资料">
            <InitialAvatar name={self.displayName} className="h-16 w-16 text-xl ring-4 ring-paper" />
          </button>
        ) : null}
      </div>
      <div className="h-14" />
      {error ? <div className="px-4 pb-3"><Notice tone="error">{error}</Notice></div> : null}
      {posts === null && !error ? <Spinner /> : null}
      {posts && posts.length === 0 ? <p className="px-4 py-16 text-center text-sm text-stone-400">还没有动态</p> : null}
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
