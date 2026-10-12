import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { POST_MAX, type ActivityPost } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { useSessionStore } from '../../../shared/session/store';
import { Button } from '../../../shared/ui/Button';
import { EmptyState, Notice, Spinner } from '../../../shared/ui/Card';
import { TextArea } from '../../../shared/ui/Field';
import { profileApi } from '../../profile/api';
import { formatPostTime } from '../../profile/format';

export function ActivityPanel() {
  const selfId = useSessionStore((s) => s.member?.id);
  const [posts, setPosts] = useState<ActivityPost[] | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  async function publish(e: FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    setError(null);
    try {
      const res = await profileApi.addPost(body);
      setPosts((prev) => [res.post, ...(prev ?? [])]);
      setText('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm('删除这条动态？')) return;
    try {
      await profileApi.removePost(id);
      setPosts((prev) => (prev ?? []).filter((post) => post.id !== id));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={publish} className="rounded-xl bg-white p-4 ring-1 ring-stone-200">
        <TextArea value={text} maxLength={POST_MAX} onChange={(e) => setText(e.target.value)} placeholder="写给其他成员的近况、机会或想法" />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs text-stone-400">
            {text.length}/{POST_MAX}
          </span>
          <Button type="submit" loading={busy} disabled={!text.trim()}>
            发布
          </Button>
        </div>
      </form>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {posts === null && !error ? <Spinner /> : null}
      {posts && posts.length === 0 ? <EmptyState>还没有人发布动态。你写的一条会出现在这里。</EmptyState> : null}
      {posts && posts.length > 0 ? (
        <div className="divide-y divide-stone-200 overflow-hidden rounded-xl bg-white ring-1 ring-stone-200">
          {posts.map((post) => (
            <article key={post.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <Link to={`/directory/${post.authorId}`} className="min-w-0">
                  <p className="truncate font-medium text-brand-800">{post.authorName}</p>
                  <p className="truncate text-xs text-stone-400">{[post.authorHeadline, formatPostTime(post.createdAt)].filter(Boolean).join(' · ')}</p>
                </Link>
                {post.authorId === selfId ? (
                  <button type="button" onClick={() => remove(post.id)} className="shrink-0 text-xs text-stone-400">
                    删除
                  </button>
                ) : null}
              </div>
              <p className="mt-2 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-stone-800">{post.body}</p>
            </article>
          ))}
        </div>
      ) : null}
    </div>
  );
}
