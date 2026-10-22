import { useEffect, useState } from 'react';
import { MINI_APPS, type MiniApp } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { useTr } from '../../../shared/i18n/locale';
import { List, Notice, PageTitle } from '../../../shared/ui/Card';
import { miniappApi } from '../api';

const SUMMARY_EN: Record<string, string> = {
  rufree: 'Shared timetables. Import your courses, overlay them with friends, find free time together, and get exam reminders.',
};

function AppMark({ app }: { app: MiniApp }) {
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-800 text-sm font-semibold text-white">
      {app.id === 'rufree' ? (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
          <rect x="4" y="5" width="16" height="15" rx="2" />
          <path d="M4 9.5h16M8 3.8v3M16 3.8v3" strokeLinecap="round" />
          <path d="M8 13h2.2M11.9 13h2.2M8 16.4h2.2M11.9 16.4h2.2" strokeLinecap="round" />
        </svg>
      ) : (
        app.name.slice(0, 1)
      )}
    </span>
  );
}

function Star({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d="m12 3 2.6 5.4 6 .9-4.3 4.2 1 6L12 16.8 6.7 19.5l1-6L3.4 9.3l6-.9L12 3Z" strokeLinejoin="round" />
    </svg>
  );
}

export function MiniappsPage() {
  const [pinned, setPinned] = useState<string[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tr = useTr();

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
      <PageTitle>{tr('小程序', 'Mini apps')}</PageTitle>
      <p className="-mt-2 mb-6 text-[11px] leading-4 text-stone-400">{tr('由技术部维护和更新', 'Maintained and updated by the technology department')}</p>

      <section>
        <h2 className="mb-2 text-[15px] font-medium">{tr('我的收藏', 'Pinned')}</h2>
        {pinnedApps.length === 0 ? (
          <p className="-mx-4 bg-white px-4 py-3 text-sm text-stone-500">{tr('点右侧星标，会固定在这里。', 'Tap the star to pin an app here.')}</p>
        ) : (
          <div className="-mx-4 grid grid-cols-5 gap-y-3 bg-white px-1 py-3">
            {pinnedApps.map((app) => (
              <a key={app.id} href={app.url} target="_blank" rel="noopener noreferrer" className="flex min-w-0 flex-col items-center gap-1 px-1 active:opacity-70">
                <AppMark app={app} />
                <span className="w-full truncate text-center text-[11px] leading-4">{app.name}</span>
              </a>
            ))}
          </div>
        )}
      </section>

      <section className="mt-7">
        <h2 className="mb-2 text-[15px] font-medium">{tr('推荐', 'Recommended')}</h2>
        {error ? <div className="mb-3"><Notice tone="error">{error}</Notice></div> : null}
        <List>
          {recommended.map((app) => {
            const on = pinned.includes(app.id);
            return (
              <div key={app.id} className="flex items-center active:bg-stone-50">
                <a href={app.url} target="_blank" rel="noopener noreferrer" className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-4">
                  <AppMark app={app} />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{app.name}</span>
                    <span className="block truncate text-sm text-stone-500">{tr(app.summary, SUMMARY_EN[app.id] ?? app.summary)}</span>
                  </span>
                </a>
                <button
                  type="button"
                  disabled={busyId === app.id}
                  onClick={() => void toggle(app)}
                  aria-label={on ? tr('取消收藏', 'Unpin') : tr('收藏', 'Pin')}
                  className={`flex h-11 w-11 shrink-0 items-center justify-center disabled:opacity-40 ${on ? 'text-brand-800' : 'text-stone-300'}`}
                >
                  <Star filled={on} />
                </button>
              </div>
            );
          })}
        </List>
      </section>
    </div>
  );
}
