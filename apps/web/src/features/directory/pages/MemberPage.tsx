import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { directRoomId, type MemberDetailResponse } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { useSessionStore } from '../../../shared/session/store';
import { Button } from '../../../shared/ui/Button';
import { Notice, Spinner } from '../../../shared/ui/Card';
import { chatApi } from '../../chat/api';
import { MemberProfileView } from '../../profile/MemberProfileView';
import { profileApi } from '../../profile/api';

export function MemberPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const self = useSessionStore((s) => s.member);
  const [detail, setDetail] = useState<MemberDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(null);
    profileApi
      .detail(id)
      .then((res) => {
        if (!cancelled) setDetail(res);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function openDirect() {
    setOpening(true);
    try {
      const res = await chatApi.openDirect(id);
      navigate(`/chat/room/${encodeURIComponent(directRoomId(res.conversationId))}`);
    } catch (err) {
      setError(errorMessage(err));
      setOpening(false);
    }
  }

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!detail) return <Spinner />;

  const mine = self?.id === detail.member.id;

  return (
    <div className="space-y-4">
      <Link to="/directory" className="text-sm text-brand-800">
        ← 返回成员列表
      </Link>
      <MemberProfileView member={detail.member} experiences={detail.experiences} posts={detail.posts} />
      {mine ? (
        <Link to="/settings" className="block text-center text-sm font-medium text-brand-800">
          编辑我的资料
        </Link>
      ) : (
        <Button block onClick={openDirect} loading={opening}>
          发私信
        </Button>
      )}
    </div>
  );
}
