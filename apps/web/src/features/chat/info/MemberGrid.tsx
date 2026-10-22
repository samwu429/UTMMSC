import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { RoomMemberCard } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { useTr } from '../../../shared/i18n/locale';
import { MemberAvatar } from '../../profile/InitialAvatar';
import { chatApi } from '../api';

/** WeChat shows four rows of five; the twentieth cell is left for the member count link below. */
/** 微信显示四行、每行五个；第二十格留给下方的查看全部链接。 */
const GRID_MAX = 19;

/** One 48px square avatar with the name under it, opening the member's profile. */
/** 一个 48px 方形头像，下方是名字，点按打开成员资料。 */
export function MemberTile({ id, name, avatarKey }: { id: string; name: string; avatarKey: string | null }) {
  return (
    <li className="min-w-0">
      <Link to={`/directory/${encodeURIComponent(id)}`} className="flex flex-col items-center gap-1.5 rounded-md py-1 active:bg-wx-pressed">
        <MemberAvatar name={name} avatarKey={avatarKey} shape="square" className="h-12 w-12 text-lg" />
        <span className="w-full truncate px-0.5 text-center text-[12px] leading-4 text-wx-meta">{name}</span>
      </Link>
    </li>
  );
}

function TileSkeleton() {
  return (
    <li className="flex flex-col items-center gap-1.5 py-1" aria-hidden>
      <span className="h-12 w-12 rounded-[4px] bg-wx-canvas" />
      <span className="h-4 w-10 rounded bg-wx-canvas" />
    </li>
  );
}

function ChevronRight() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m9 5 7 7-7 7" />
    </svg>
  );
}

type GridState = { members: RoomMemberCard[]; error: string | null; loading: boolean };

/**
 * The first members of a channel as a five-column avatar grid, followed by the link that opens the full,
 * searchable member list. Space for the expected tiles is kept while they load, so nothing below jumps.
 * 频道的前几位成员，以每行五个的头像网格显示，下方是打开完整、可搜索成员列表的链接。加载期间预留应有的格子，下方内容不会跳动。
 */
export function MemberGrid({ roomId, total, onViewAll }: { roomId: string; total: number; onViewAll: () => void }) {
  const tr = useTr();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<GridState>({ members: [], error: null, loading: true });

  useEffect(() => {
    let cancelled = false;
    chatApi.members(roomId, { limit: GRID_MAX }).then(
      (page) => !cancelled && setState({ members: page.members.slice(0, GRID_MAX), error: null, loading: false }),
      (error: unknown) => !cancelled && setState({ members: [], error: errorMessage(error), loading: false }),
    );
    return () => {
      cancelled = true;
    };
  }, [roomId, attempt]);

  const placeholders = state.loading ? Math.min(GRID_MAX, Math.max(1, total)) : 0;

  return (
    <div>
      <div className="px-3 pb-2 pt-4">
        {state.error ? (
          <div className="py-4 text-center text-[14px] text-wx-meta">
            <p>{state.error}</p>
            <button
              type="button"
              onClick={() => {
                setState({ members: [], error: null, loading: true });
                setAttempt((n) => n + 1);
              }}
              className="mt-1 min-h-11 px-3 text-wx-link"
            >
              {tr('重试', 'Retry')}
            </button>
          </div>
        ) : (
          <ul className="grid grid-cols-5 gap-x-2 gap-y-3" aria-busy={state.loading}>
            {state.members.map((member) => (
              <MemberTile key={member.id} id={member.id} name={member.displayName} avatarKey={member.avatarKey} />
            ))}
            {Array.from({ length: placeholders }, (_, index) => (
              <TileSkeleton key={index} />
            ))}
          </ul>
        )}
      </div>
      <button type="button" onClick={onViewAll} className="flex min-h-12 w-full items-center justify-center gap-0.5 pb-2 text-[15px] text-wx-meta active:bg-wx-pressed">
        {tr(`查看全部成员（${total}）`, `View all members (${total})`)}
        <ChevronRight />
      </button>
    </div>
  );
}
