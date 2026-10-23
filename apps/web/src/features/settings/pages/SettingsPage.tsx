import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTr } from '../../../shared/i18n/locale';
import { useStatusBarColor } from '../../../shared/ui/useStatusBarColor';
import { AccountPanel, type Screen } from '../panels/AccountPanel';
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
  // ?screen=notifications opens that screen once, e.g. from the chat-list prompt; the parameter is then dropped.
  // ?screen=notifications 会打开该页面一次，例如从聊天列表的提示进入；之后去掉这个参数。
  const [initialScreen] = useState<Screen>(() => (tab === 'settings' && params.get('screen') === 'notifications' ? 'notifications' : 'list'));
  const [pushed, setPushed] = useState(false);
  const tr = useTr();
  useStatusBarColor('#FFFFFF');

  useEffect(() => {
    if (params.has('screen')) setParams(tab === 'profile' ? {} : { tab }, { replace: true });
  }, [params, setParams, tab]);

  function select(next: Tab) {
    setPushed(false);
    setParams(next === 'profile' ? {} : { tab: next }, { replace: true });
  }

  return (
    <div className="-mx-4 -mt-5">
      {pushed ? null : (
        <div className="sticky top-[var(--safe-top)] z-20 flex border-b border-stone-200 bg-white" role="tablist">
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
        <div className={`px-4 pb-4 ${pushed ? 'pt-5' : 'pt-4'}`}>
          <AccountPanel onOpenProfile={() => select('profile')} onPushed={setPushed} initialScreen={initialScreen} />
        </div>
      ) : null}
    </div>
  );
}
