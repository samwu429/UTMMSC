import { useEffect, useState } from 'react';
import { MINI_APPS, type MiniApp } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { Notice, PageTitle } from '../../../shared/ui/Card';
import { miniappApi } from '../api';

function Mark({ name }: { name: string }) {
  return (
    <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-brand-800 text-lg font-semibold text-white">
      {name.slice(0, 1)}
    </span>
  );
}

function PinButton({ pinned, busy, onClick }: { pinned: boolean; busy: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      aria-label={pinned ? '取消收藏' : '收藏'}
      className={`flex h-11 w-11 items-center justify-center rounded-full disabled:opacity-40 ${pinned ? 'text-brand-800' : 'text-stone-300'}`}
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill={pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.75" aria-hidden>
        <path d="m12 3 2.6 5.4 6 .9-4.3 4.2 1 6L12 16.8 6.7 19.5l1-6L3.4 9.3l6-.9L12 3Z" strokeLinejoin="round" />
      </svg>
    </button>
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
      <p className="mb-6 text-xs tracking-wide text-stone-400">Maintained and updated by technology department</p>

      <section>
        <h2 className="mb-2 text-[15px] font-medium text-brand-800">我的收藏</h2>
        {pinnedApps.length === 0 ? (
          <p className="text-sm leading-relaxed text-stone-400">点推荐里的星标，收藏的小程序会出现在这里。</p>
        ) : (
          <div className="flex gap-4 overflow-x-auto pb-1">
            {pinnedApps.map((app) => (
              <a key={app.id} href={app.url} target="_blank" rel="noopener noreferrer" className="flex w-16 shrink-0 flex-col items-center gap-1.5">
                <Mark name={app.name} />
                <span className="w-full truncate text-center text-[11px] text-brand-800">{app.name}</span>
              </a>
            ))}
          </div>
        )}
      </section>

      <section className="mt-7">
        <h2 className="mb-2 text-[15px] font-medium text-brand-800">推荐</h2>
        {error ? <div className="mb-3"><Notice tone="error">{error}</Notice></div> : null}
        <div className="space-y-3">
          {recommended.map((app) => {
            const on = pinned.includes(app.id);
            return (
              <article key={app.id} className="flex items-start gap-3 rounded-xl bg-white p-4 ring-1 ring-stone-200">
                <Mark name={app.name} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-brand-800">{app.name}</p>
                  <p className="mt-1 text-sm leading-relaxed text-stone-600">{app.summary}</p>
                  <a href={app.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-brand-800">
                    打开 {app.url.replace(/^https?:\/\//, '')}
                  </a>
                </div>
                <PinButton pinned={on} busy={busyId === app.id} onClick={() => void toggle(app)} />
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
