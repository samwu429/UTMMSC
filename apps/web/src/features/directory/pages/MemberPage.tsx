import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { directRoomId, type FriendshipState, type MemberDetailResponse } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { useTr } from '../../../shared/i18n/locale';
import { useSessionStore } from '../../../shared/session/store';
import { BackHeader } from '../../../shared/ui/BackHeader';
import { Button } from '../../../shared/ui/Button';
import { Notice, Spinner } from '../../../shared/ui/Card';
import { chatApi } from '../../chat/api';
import { friendsApi } from '../../friends/api';
import { MemberProfileView } from '../../profile/MemberProfileView';
import { profileApi } from '../../profile/api';

export function MemberPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const tr = useTr();
  const self = useSessionStore((s) => s.member);
  const setMediaToken = useSessionStore((s) => s.setMediaToken);
  const [detail, setDetail] = useState<MemberDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [friendship, setFriendship] = useState<FriendshipState>('none');
  const [friendBusy, setFriendBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(null);
    profileApi
      .detail(id)
      .then((res) => {
        if (cancelled) return;
        setDetail(res);
        setFriendship(res.friendship ?? 'none');
        setMediaToken(res.mediaToken);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [id, setMediaToken]);

  async function changeFriend(action: 'request' | 'accept' | 'reject') {
    if (!detail) return;
    setFriendBusy(true);
    setNotice(null);
    try {
      const res = action === 'request' ? await friendsApi.request(detail.member.id) : action === 'accept' ? await friendsApi.accept(detail.member.id) : await friendsApi.reject(detail.member.id);
      setFriendship(res.friendship);
    } catch (err) {
      setNotice(errorMessage(err));
    } finally {
      setFriendBusy(false);
    }
  }

  async function openDirect() {
    setOpening(true);
    try {
      const res = await chatApi.openDirect(id);
      navigate(`/chat/room/${encodeURIComponent(directRoomId(res.conversationId))}`);
    } catch (err) {
      setNotice(errorMessage(err));
      setOpening(false);
    }
  }

  const mine = self?.id === detail?.member.id;

  return (
    <div>
      <BackHeader to="/chat?tab=members" label={tr('通讯录', 'Contacts')} />
      {error && !detail ? <Notice tone="error">{error}</Notice> : null}
      {!detail && !error ? <Spinner /> : null}
      {notice ? <div className="mb-3"><Notice tone="error">{notice}</Notice></div> : null}
      {detail ? <div className="-mx-4">
        <MemberProfileView
          member={detail.member}
          experiences={detail.experiences}
          posts={detail.posts}
          action={
            mine ? (
              <Button block variant="secondary" onClick={() => navigate('/settings')}>
                {tr('编辑资料', 'Edit profile')}
              </Button>
            ) : friendship === 'friends' ? (
              <Button block onClick={openDirect} loading={opening}>
                {tr('发私信', 'Message')}
              </Button>
            ) : friendship === 'outgoing' ? (
              <Button block variant="secondary" disabled>
                {tr('等待通过', 'Pending')}
              </Button>
            ) : friendship === 'incoming' ? (
              <div className="flex gap-2">
                <Button className="flex-1" loading={friendBusy} onClick={() => changeFriend('accept')}>
                  {tr('通过申请', 'Accept request')}
                </Button>
                <Button className="flex-1" variant="secondary" disabled={friendBusy} onClick={() => changeFriend('reject')}>
                  {tr('拒绝', 'Decline')}
                </Button>
              </div>
            ) : (
              <Button block loading={friendBusy} onClick={() => changeFriend('request')}>
                {tr('加好友', 'Add friend')}
              </Button>
            )
          }
        />
      </div> : null}
    </div>
  );
}
