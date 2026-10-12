import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ActivityPanel } from '../../settings/panels/ActivityPanel';

export function DiscoverFeedPage() {
  const navigate = useNavigate();
  const [composing, setComposing] = useState(false);

  return (
    <div className="-mx-4 -mt-5">
      {composing ? null : (
        <Link to="/discover" className="inline-block px-4 py-3 text-sm text-brand-800">
          ← 发现
        </Link>
      )}
      <ActivityPanel onOpenProfile={() => navigate('/settings')} onPushed={setComposing} />
    </div>
  );
}
