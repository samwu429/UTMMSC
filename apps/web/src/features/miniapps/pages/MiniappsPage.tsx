import { useEffect, useState } from 'react';
import { MINI_APPS, type MiniApp } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { Notice, PageTitle } from '../../../shared/ui/Card';
import { miniappApi } from '../api';

function hostOf(url: string) {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

function AppMark({ app, compact = false }: { app: MiniApp; compact?: boolean }) {
  const box = compact ? 'h-14 w-14 rounded-2xl' : 'h-16 w-16 rounded-[20px]';
  return (
    <span className={`flex shrink-0 flex-col items-center justify-center bg-brand-800 text-white ${box}`}>
      {app.id === 'rufree' ? (
        <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
          <rect x="4" y="5" width="16" height="15" rx="2" />
          <path d="M4 9.5h16M8 3.8v3M16 3.8v3" strokeLinecap="round" />
          <path d="M8 13h2.2M11.9 13h2.2M8 16.4h2.2M11.9 16.4h2.2" strokeLinecap="round" />
        </svg>
      ) : (
        <span className="text-lg font-semibold">{app.name.slice(0, 1)}</span>
      )}
      <span className="mt-1 h-[2px] w-5 rounded-full bg-gold" />
    </span>
  );
}

function Star({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d="m12 3 2.6 5.4 6 .9-4.3 4.2 1 6L12 16.8 6.7 19.5l1-6L3.4 9.3l6-.9L12 3Z" strokeLinejoin="round" />
    </svg>
  );
}

export function MiniappsPage() {
  const [pinned, setPinned] = useState<string[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    miniappApi.pins().then((res) => setPinned(res.ids)).catch((err) => setError(errorMessage(err)));
  }, []);

  const pinnedApps = pinned.map((id) => MINI_APPS.find((app) => app.id === id)).filter((app): app is MiniApp => Boolean(app));
  const recommended = MINI_APPS.filter((app) => app.recommended);

  // Paint the pin immediately, then undo it if the server rejects the change.
  // 先把收藏画上去，服务端拒绝再改回来。
  async function toggle(app: MiniApp) {
    const on = pinned.includes(app.id);
    setBusyId(app.id);
    setError(null);
    setPinned((prev) => (on ? prev.filter((id) => id !== app.id) : [app.id, ...prev.filter((id) => id !== app.id)]));
    try {
      if (on) await miniappApi.unpin(app.id);
      else await miniappApi.pin(app.id);
    } catch (err) {
      setPinned((prev) => (on ? [app.id, ...prev] : prev.filter((id) => id !== app.id)));
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <PageTitle>小程序</PageTitle>
      <p className="-mt-2 mb-6 text-[11px] leading-4 text-stone-400">Maintained and updated by technology department</p>

      <section>
        <h2 className="mb-2 text-[15px] font-medium">我的收藏</h2>
        {pinnedApps.length === 0 ? (
          <div className="flex items-center gap-3 rounded-xl bg-white px-4 py-3.5 ring-1 ring-stone-200">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-dashed border-stone-300 text-stone-300">
              <Star filled={false} />
            </span>
            <p className="text-sm leading-relaxed text-stone-500">点下面的收藏，常用的小程序会固定在这里。</p>
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-y-4 rounded-xl bg-white px-2 py-4 ring-1 ring-stone-200">
            {pinnedApps.map((app) => (
              <a key={app.id} href={app.url} target="_blank" rel="noopener noreferrer" className="flex min-w-0 flex-col items-center gap-1.5 px-1 active:opacity-70">
                <AppMark app={app} compact />
                <span className="w-full truncate text-center text-[11px] leading-4">{app.name}</span>
              </a>
            ))}
          </div>
        )}
      </section>

      <section className="mt-7">
        <h2 className="mb-2 text-[15px] font-medium">推荐</h2>
        {error ? <div className="mb-3"><Notice tone="error">{error}</Notice></div> : null}
        <div className="space-y-3">
          {recommended.map((app) => {
            const on = pinned.includes(app.id);
            return (
              <article key={app.id} className="rounded-xl bg-white p-4 ring-1 ring-stone-200">
                <div className="flex items-start gap-3">
                  <AppMark app={app} />
                  <div className="min-w-0 flex-1 pt-0.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-[17px] font-semibold leading-tight">{app.name}</p>
                        <p className="mt-1 text-xs text-stone-400">{hostOf(app.url)}</p>
                      </div>
                      <button
                        type="button"
                        disabled={busyId === app.id}
                        onClick={() => void toggle(app)}
                        className={`inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full px-3 text-xs font-medium disabled:opacity-40 ${on ? 'bg-brand-50 text-brand-800' : 'bg-paper text-stone-500'}`}
                      >
                        <Star filled={on} />
                        {on ? '已收藏' : '收藏'}
                      </button>
                    </div>
                  </div>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-stone-600">{app.summary}</p>
                <a
                  href={app.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 flex min-h-11 items-center justify-center rounded-lg border-t-[3px] border-gold bg-brand-800 text-[15px] font-medium text-white"
                >
                  打开
                </a>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
