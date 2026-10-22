import { useEffect, useId, useState } from 'react';
import { useLocation, useNavigate, useNavigationType, useParams, type Location } from 'react-router-dom';
import { HISTORY_VISIBILITY_LABELS, parseRoomId, type ChatPrefs, type RoomMeta } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { useTr } from '../../../shared/i18n/locale';
import { BackHeader } from '../../../shared/ui/BackHeader';
import { useConfirm } from '../../../shared/ui/confirm';
import { toast } from '../../../shared/ui/toast';
import { WxSpinner } from '../../../shared/ui/WxSpinner';
import { chatApi } from '../api';
import { InfoCell, InfoGroup } from '../info/InfoCell';
import { MemberGrid, MemberTile } from '../info/MemberGrid';
import { MemberListSheet } from '../info/MemberListSheet';
import { Switch } from '../info/Switch';
import { useRoomInfo } from '../info/useRoomInfo';
import { DEFAULT_CHAT_PREFS, roomLink } from '../list/conversations';
import { roomById, useOverviewStore } from '../state/overviewStore';
import { dropRoomSnapshot } from '../transport/roomCache';

/** True when there is an in-app page to return to, rather than a page opened straight from a link. */
/** 存在可返回的站内页面时为 true，而不是直接从链接打开的页面。 */
function canGoBack(location: Location): boolean {
  if (location.key === 'default') return false;
  const index = (window.history.state as { idx?: unknown } | null)?.idx;
  return typeof index !== 'number' || index > 0;
}

type PrefKey = 'muted' | 'pinned';

function SwitchCell({ label, checked, onChange }: { label: string; checked: boolean; onChange: (next: boolean) => void }) {
  const labelId = useId();
  return <InfoCell label={label} labelId={labelId} trailing={<Switch checked={checked} onChange={onChange} labelledBy={labelId} />} />;
}

function ChannelSection({ roomId, info, onViewAll }: { roomId: string; info: RoomMeta; onViewAll: () => void }) {
  const tr = useTr();
  const history = info.historyVisibility ? HISTORY_VISIBILITY_LABELS[info.historyVisibility] : null;
  return (
    <>
      <InfoGroup flush>
        <MemberGrid roomId={roomId} total={info.memberCount} onViewAll={onViewAll} />
      </InfoGroup>
      <InfoGroup>
        <InfoCell label={tr('频道名称', 'Channel name')} value={info.title} />
        <InfoCell label={tr('频道简介', 'Description')} detail={info.description?.trim() ? info.description : tr('暂无简介', 'No description')} />
        {history ? <InfoCell label={tr('历史消息', 'Chat history')} value={tr(history.zh, history.en)} /> : null}
      </InfoGroup>
      {info.canManage ? (
        <InfoGroup>
          <InfoCell label={tr('频道设置', 'Channel settings')} to="/admin?tab=channels" />
        </InfoGroup>
      ) : null}
    </>
  );
}

function DirectSection({ info }: { info: RoomMeta }) {
  const peer = info.peer;
  if (!peer) return null;
  return (
    <InfoGroup flush>
      <ul className="grid grid-cols-5 gap-x-2 px-3 pb-3 pt-4">
        <MemberTile id={peer.id} name={peer.displayName} avatarKey={peer.avatarKey} />
      </ul>
    </InfoGroup>
  );
}

function ChatInfoScreen({ roomId }: { roomId: string }) {
  const tr = useTr();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const location = useLocation();
  const navigationType = useNavigationType();
  const { info, error, fatal, loading, reload, update } = useRoomInfo(roomId);
  const overviewPrefs = useOverviewStore((s) => roomById(s.data, roomId)?.prefs ?? null);
  const [override, setOverride] = useState<Partial<ChatPrefs>>({});
  const [membersOpen, setMembersOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [slideIn] = useState(() => navigationType !== 'POP');

  useEffect(() => {
    void useOverviewStore.getState().refresh();
  }, []);

  // The list's copy wins once it has this room, because the list, the header and this page must agree.
  // 会话列表中有这个房间后以列表的数据为准，列表、房间标题栏和本页才能保持一致。
  const prefs: ChatPrefs = overviewPrefs ?? { ...(info?.prefs ?? DEFAULT_CHAT_PREFS), ...override };
  const kind = info?.kind ?? parseRoomId(roomId)?.kind ?? 'channel';

  function goBack() {
    if (canGoBack(location)) navigate(-1);
    else navigate(roomLink(roomId), { replace: true });
  }

  function setPref(key: PrefKey, value: boolean) {
    setOverride((current) => ({ ...current, [key]: value }));
    if (info) update({ prefs: { ...info.prefs, [key]: value } });
    void useOverviewStore.getState().patchPrefs(roomId, { [key]: value });
  }

  async function clearHistory() {
    if (clearing) return;
    const ok = await confirm({
      title: tr('清空聊天记录？', 'Clear chat history?'),
      body: tr('只会清空你自己的聊天记录，其他成员不受影响。', 'This clears it only for you. Other members are not affected.'),
      confirmLabel: tr('清空', 'Clear'),
      danger: true,
    });
    if (!ok) return;
    setClearing(true);
    try {
      await chatApi.clearHistory(roomId);
      // The room screen kept a snapshot of the rows when it closed; it must not show them again.
      // 房间页关闭时保存了消息快照；之后不能再显示这些内容。
      dropRoomSnapshot(roomId);
      useOverviewStore.getState().markRoomRead(roomId);
      void useOverviewStore.getState().refresh({ force: true });
      toast(tr('已清空', 'Cleared'));
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="min-h-[100dvh] overflow-x-clip bg-wx-canvas">
      <div className={`mx-auto min-h-[100dvh] max-w-2xl bg-wx-canvas ${slideIn ? 'wx-push-in' : ''}`}>
        <div className="sticky top-0 z-20 bg-white" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
          <BackHeader flush onBack={goBack} label={tr('聊天', 'Chat')} title={tr('聊天信息', 'Chat info')} />
        </div>

        {!info ? (
          <div className="flex flex-col items-center px-8 py-16 text-center text-[14px] text-wx-meta">
            {loading ? (
              <WxSpinner />
            ) : (
              <>
                <p>{error}</p>
                {fatal ? null : (
                  <button type="button" onClick={reload} className="mt-1 min-h-11 px-3 text-wx-link">
                    {tr('重试', 'Retry')}
                  </button>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="pb-[max(24px,env(safe-area-inset-bottom))]">
            {kind === 'channel' ? <ChannelSection roomId={roomId} info={info} onViewAll={() => setMembersOpen(true)} /> : <DirectSection info={info} />}
            <InfoGroup>
              <SwitchCell label={tr('消息免打扰', 'Mute notifications')} checked={prefs.muted} onChange={(next) => setPref('muted', next)} />
              <SwitchCell label={tr('置顶聊天', 'Pin chat')} checked={prefs.pinned} onChange={(next) => setPref('pinned', next)} />
            </InfoGroup>
            <InfoGroup>
              <InfoCell label={tr('清空聊天记录', 'Clear chat history')} danger onClick={() => void clearHistory()} />
            </InfoGroup>
          </div>
        )}
      </div>
      {membersOpen && info ? <MemberListSheet roomId={roomId} total={info.memberCount} onClose={() => setMembersOpen(false)} /> : null}
    </div>
  );
}

/**
 * 聊天信息 for one room, full screen outside the tab shell: members, channel details, mute and pin, and
 * clearing the member's own chat history. Keyed by room, so nothing carries over between rooms.
 * 单个房间的「聊天信息」全屏页，不在标签外壳内：成员、频道资料、免打扰与置顶，以及清空自己的聊天记录。
 * 按房间区分实例，不同房间之间不会带入任何状态。
 */
export function ChatInfoPage() {
  const { roomId = '' } = useParams();
  return <ChatInfoScreen key={roomId} roomId={roomId} />;
}
