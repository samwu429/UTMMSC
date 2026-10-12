import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTr } from '../../../shared/i18n/locale';
import { AccountPanel } from '../panels/AccountPanel';
import { ProfilePanel } from '../panels/ProfilePanel';

const TABS = [
  { id: 'profile', zh: '资料', en: 'Profile' },
  { id: 'settings', zh: '设置', en: 'Settings' },
] as const;

type Tab = (typeof TABS)[number]['id'];

function tabFromQuery(value: string | null): Tab {
  if (value === 'settings') return value;
  return 'profile';
}

export function SettingsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = tabFromQuery(params.get('tab'));
  const [pushed, setPushed] = useState(false);
  const tr = useTr();

  function select(next: Tab) {
    setPushed(false);
    setParams(next === 'profile' ? {} : { tab: next }, { replace: true });
  }

  return (
    <div className="-mx-4 -mt-5">
      {pushed ? null : (
        <div className="sticky top-0 z-20 flex border-b border-stone-200 bg-white" role="tablist">
          {TABS.map((item) => {
            const on = item.id === tab;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => select(item.id)}
                className={`min-h-11 flex-1 text-[15px] ${on ? 'font-medium text-brand-800' : 'text-stone-400'}`}
              >
                <span className="inline-flex min-h-11 flex-col items-center justify-center">
                  {tr(item.zh, item.en)}
                  <span className={`mt-1 h-[3px] w-8 ${on ? 'bg-gold' : 'bg-transparent'}`} />
                </span>
              </button>
            );
          })}
        </div>
      )}
      {tab === 'profile' ? <ProfilePanel onShowActivity={() => navigate('/discover/feed')} /> : null}
      {tab === 'settings' ? (
        <div className="px-4 py-4">
          <AccountPanel onOpenProfile={() => select('profile')} onPushed={setPushed} />
        </div>
      ) : null}
    </div>
  );
}
