import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BackHeader } from '../../../shared/ui/BackHeader';
import { ActivityPanel } from '../../settings/panels/ActivityPanel';

export function DiscoverFeedPage() {
  const navigate = useNavigate();
  const [composing, setComposing] = useState(false);

  return (
    <div>
      {composing ? null : <BackHeader to="/discover" label="发现" title="好友动态" />}
      <div className="-mx-4">
        <ActivityPanel onOpenProfile={() => navigate('/settings')} onPushed={setComposing} />
      </div>
    </div>
  );
}
