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
  const setMediaToken = useSessionStore((s) => s.setMediaToken);
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
        if (cancelled) return;
        setDetail(res);
        setMediaToken(res.mediaToken);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [id, setMediaToken]);

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
    <div>
      <Link to="/directory" className="mb-3 inline-block text-sm text-brand-800">
        ← 返回成员列表
      </Link>
      <div className="-mx-4">
        <MemberProfileView
          member={detail.member}
          experiences={detail.experiences}
          posts={detail.posts}
          action={
            mine ? (
              <Link to="/settings" className="text-[15px] font-medium text-brand-800">
                编辑资料
              </Link>
            ) : (
              <Button block onClick={openDirect} loading={opening}>
                发私信
              </Button>
            )
          }
        />
      </div>
    </div>
  );
}
