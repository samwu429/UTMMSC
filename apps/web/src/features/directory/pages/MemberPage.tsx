import { useCallback, useEffect, useId, useState } from 'react';
import { useLocation, useNavigate, useParams, type Location } from 'react-router-dom';
import { directRoomId, type FriendshipState, type MemberDetailResponse, type MomentRelation } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { useTr } from '../../../shared/i18n/locale';
import { useSessionStore } from '../../../shared/session/store';
import { Button } from '../../../shared/ui/Button';
import { Notice, Spinner } from '../../../shared/ui/Card';
import { toast } from '../../../shared/ui/toast';
import { useStatusBarColor } from '../../../shared/ui/useStatusBarColor';
import { WxSpinner } from '../../../shared/ui/WxSpinner';
import { chatApi } from '../../chat/api';
import { Switch } from '../../chat/info/Switch';
import { friendsApi } from '../../friends/api';
import { momentsApi } from '../../moments/api';
import { MoreIcon } from '../../moments/icons';
import { HOME_FEED } from '../../moments/model';
import { useFeedStore } from '../../moments/state/feedStore';
import { MemberProfileView } from '../../profile/MemberProfileView';
import { Sheet } from '../../profile/Sheet';
import { profileApi } from '../../profile/api';

/** True when there is an in-app page to return to, rather than a profile opened straight from a link. */
/** 存在可返回的站内页面时为 true，而不是直接从链接打开的资料页。 */
function canGoBack(location: Location): boolean {
  if (location.key === 'default') return false;
  const index = (window.history.state as { idx?: unknown } | null)?.idx;
  return typeof index !== 'number' || index > 0;
}

function Chevron() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m14 6-6 6 6 6" />
    </svg>
  );
}

/**
 * The sticky back bar of a profile, styled as BackHeader. A profile opens from contacts, chats, rooms and 好友动态,
 * so back returns to whichever it was (the feed comes back at the same place) and simply says 返回; a profile
 * opened from a link returns to 通讯录.
 * 资料页的吸顶返回栏，样式与 BackHeader 相同。资料页可以从通讯录、聊天、聊天室和好友动态打开，因此返回到原来的页面
 * （好友动态会回到原来的位置），按钮只写「返回」；从链接直接打开的资料页返回「通讯录」。
 */
function ProfileBackBar({ onMore }: { onMore?: () => void }) {
  const tr = useTr();
  const navigate = useNavigate();
  const location = useLocation();
  const inApp = canGoBack(location);
  useStatusBarColor('#FFFFFF');

  function back() {
    if (inApp) navigate(-1);
    else navigate('/chat?tab=members', { replace: true });
  }

  return (
    <header className="sticky top-[var(--safe-top)] z-20 -mx-4 -mt-5 mb-4 flex min-h-12 items-center border-b border-stone-200 bg-white px-1">
      <button
        type="button"
        onClick={back}
        className="flex min-h-11 items-center gap-0.5 rounded-lg px-2 text-[16px] font-medium text-brand-800 active:bg-stone-100"
        aria-label={inApp ? tr('返回', 'Back') : tr('返回通讯录', 'Back to Contacts')}
      >
        <Chevron />
        {inApp ? tr('返回', 'Back') : tr('通讯录', 'Contacts')}
      </button>
      {onMore ? (
        <div className="ml-auto flex min-w-11 items-center justify-end pr-1">
          <button
            type="button"
            onClick={onMore}
            aria-label={tr('动态权限', 'Update privacy')}
            aria-haspopup="dialog"
            className="flex h-11 w-11 items-center justify-center rounded-lg text-brand-800 active:bg-stone-100"
          >
            <MoreIcon />
          </button>
        </div>
      ) : null}
    </header>
  );
}

function PrivacyRow({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (next: boolean) => void }) {
  const labelId = useId();
  return (
    <div className="flex min-h-14 items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p id={labelId} className="text-[17px] leading-6 text-wx-ink">
          {label}
        </p>
        <p className="mt-0.5 text-[13px] leading-[18px] text-wx-meta">{hint}</p>
      </div>
      <Switch checked={checked} onChange={onChange} labelledBy={labelId} />
    </div>
  );
}

/**
 * 动态权限 for one member, as WeChat's 朋友权限: 不让TA看我的动态 hides every update from them, whatever its
 * audience; 不看TA的动态 keeps theirs off the home feed. A switch shows the new state at once and goes back,
 * with a toast, if the server refuses. Both lists are managed again in 动态设置.
 * 针对一位成员的「动态权限」，与微信的「朋友权限」一致：「不让TA看我的动态」对其隐藏全部动态，不论可见范围；
 * 「不看TA的动态」让对方的动态不出现在动态首页。开关立即显示新状态，服务器拒绝时恢复原状并提示。两个名单都可以在「动态设置」中再管理。
 */
function MomentPrivacySheet({ memberId, onClose }: { memberId: string; onClose: () => void }) {
  const tr = useTr();
  const [relation, setRelation] = useState<MomentRelation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<keyof MomentRelation | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    momentsApi
      .relation(memberId)
      .then((res) => {
        if (!cancelled) setRelation(res);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [memberId, attempt]);

  async function change(field: keyof MomentRelation, next: boolean) {
    if (!relation || saving) return;
    const before = relation;
    setRelation({ ...relation, [field]: next });
    setSaving(field);
    try {
      const res = await momentsApi.updateRelation(memberId, { [field]: next });
      setRelation(res);
      // 不看TA takes effect on the home feed at once, if it is loaded.
      // 「不看TA」立即在动态首页生效（如果首页已加载）。
      if (field === 'mute') {
        const store = useFeedStore.getState();
        if (store.lists[HOME_FEED]?.status === 'ready') void store.refresh(HOME_FEED);
      }
    } catch (err) {
      setRelation(before);
      toast(errorMessage(err));
    } finally {
      setSaving(null);
    }
  }

  return (
    <Sheet title={tr('动态权限', 'Update privacy')} closeLabel={tr('完成', 'Done')} onClose={onClose}>
      {relation ? (
        <div className="-mx-4 divide-y-[0.5px] divide-wx-line border-y-[0.5px] border-wx-line">
          <PrivacyRow
            label={tr('不让TA看我的动态', 'Hide my updates from them')}
            hint={tr('TA 将看不到你发的任何动态', "They won't see any of your updates")}
            checked={relation.hideFrom}
            onChange={(next) => void change('hideFrom', next)}
          />
          <PrivacyRow
            label={tr('不看TA的动态', 'Hide their updates')}
            hint={tr('TA 的动态不再出现在你的好友动态里', "Their updates won't show in your friend updates")}
            checked={relation.mute}
            onChange={(next) => void change('mute', next)}
          />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center py-8 text-center text-[14px] text-wx-meta">
          <p>{error}</p>
          <button type="button" onClick={() => setAttempt((value) => value + 1)} className="mt-1 min-h-11 px-3 text-wx-link">
            {tr('重试', 'Retry')}
          </button>
        </div>
      ) : (
        <div className="flex justify-center py-10">
          <WxSpinner />
        </div>
      )}
    </Sheet>
  );
}

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
  const [privacyOpen, setPrivacyOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(null);
    setPrivacyOpen(false);
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

  const memberId = detail?.member.id ?? null;
  const mine = self?.id === memberId;
  const openAlbum = useCallback(() => {
    if (memberId) navigate(`/discover/feed/member/${encodeURIComponent(memberId)}`);
  }, [memberId, navigate]);
  const closePrivacy = useCallback(() => setPrivacyOpen(false), []);

  return (
    <div>
      <ProfileBackBar onMore={detail && !mine ? () => setPrivacyOpen(true) : undefined} />
      {error && !detail ? <Notice tone="error">{error}</Notice> : null}
      {!detail && !error ? <Spinner /> : null}
      {notice ? <div className="mb-3"><Notice tone="error">{notice}</Notice></div> : null}
      {detail ? <div className="-mx-4">
        <MemberProfileView
          member={detail.member}
          experiences={detail.experiences}
          posts={detail.posts}
          onShowActivity={openAlbum}
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
      {privacyOpen && memberId && !mine ? <MomentPrivacySheet memberId={memberId} onClose={closePrivacy} /> : null}
    </div>
  );
}
