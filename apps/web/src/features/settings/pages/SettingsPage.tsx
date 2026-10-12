import { useSearchParams } from 'react-router-dom';
import { PageTitle } from '../../../shared/ui/Card';
import { AccountPanel } from '../panels/AccountPanel';
import { ActivityPanel } from '../panels/ActivityPanel';
import { ProfilePanel } from '../panels/ProfilePanel';

const TABS = [
  { id: 'profile', label: '资料' },
  { id: 'activity', label: '动态' },
  { id: 'settings', label: '设置' },
] as const;

type Tab = (typeof TABS)[number]['id'];

function tabFromQuery(value: string | null): Tab {
  if (value === 'activity' || value === 'settings') return value;
  return 'profile';
}

export function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const tab = tabFromQuery(params.get('tab'));

  function select(next: Tab) {
    setParams(next === 'profile' ? {} : { tab: next }, { replace: true });
  }

  return (
    <div>
      <PageTitle>我的</PageTitle>
      <div className="mb-5 flex border-b border-stone-200" role="tablist">
        {TABS.map((item) => {
          const on = item.id === tab;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => select(item.id)}
              className={`-mb-px flex-1 border-b-2 pb-2 text-sm ${on ? 'border-brand-800 font-medium text-brand-800' : 'border-transparent text-stone-400'}`}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {tab === 'profile' ? <ProfilePanel onShowActivity={() => select('activity')} /> : null}
      {tab === 'activity' ? <ActivityPanel /> : null}
      {tab === 'settings' ? <AccountPanel /> : null}
    </div>
  );
}
