import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTr } from '../../../shared/i18n/locale';
import { useStatusBarColor } from '../../../shared/ui/useStatusBarColor';
import { AccountPanel, type ScreenRequest } from '../panels/AccountPanel';
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
  // ?screen=notifications opens that screen, e.g. from the chat-list prompt or a tapped notice, also when
  // settings is already open on another screen; the parameter is then dropped. Each request is new, so the
  // same screen can be asked for twice.
  // ?screen=notifications 会打开该页面，例如从聊天列表的提示或被点开的通知进入，设置已打开在其他页面时也一样；之后去掉这个参数。
  // 每次请求都是新的，因此同一个页面可以被请求两次。
  const asked = tab === 'settings' && params.get('screen') === 'notifications';
  const [openRequest, setOpenRequest] = useState<ScreenRequest | null>(() => (asked ? { screen: 'notifications', id: 0 } : null));
  const [pushed, setPushed] = useState(false);
  const tr = useTr();
  useStatusBarColor('#FFFFFF');

  useEffect(() => {
    if (!params.has('screen')) return;
    if (asked) setOpenRequest((previous) => ({ screen: 'notifications', id: (previous?.id ?? 0) + 1 }));
    setParams(tab === 'profile' ? {} : { tab }, { replace: true });
  }, [asked, params, setParams, tab]);

  function select(next: Tab) {
    setPushed(false);
    // The request was for the screen open then; coming back to 设置 later starts at the list.
    // 这个请求针对当时打开的页面；之后回到「设置」时从列表开始。
    setOpenRequest(null);
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
          <AccountPanel onOpenProfile={() => select('profile')} onPushed={setPushed} openRequest={openRequest} />
        </div>
      ) : null}
    </div>
  );
}
