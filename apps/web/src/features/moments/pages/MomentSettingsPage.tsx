import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { Link, useNavigationType } from 'react-router-dom';
import type { MomentPerson, UpdateMomentRelationBody } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { useTr } from '../../../shared/i18n/locale';
import { useSessionStore } from '../../../shared/session/store';
import { toast } from '../../../shared/ui/toast';
import { useStatusBarColor } from '../../../shared/ui/useStatusBarColor';
import { WX_COLORS } from '../../../shared/ui/wxTokens';
import { WxSpinner } from '../../../shared/ui/WxSpinner';
import { MemberAvatar } from '../../profile/InitialAvatar';
import { momentsApi } from '../api';
import { FeedError } from '../components/FeedStates';
import { MomentsHeader } from '../components/MomentsHeader';
import { HEADER_HEIGHT } from '../layout/pull';
import { useMomentsBack } from './MomentDetailPage';

/** hideFrom: 不让TA看我的动态. muted: 不看TA的动态. */
/** hideFrom：不让TA看我的动态。muted：不看TA的动态。 */
type ListKind = 'hideFrom' | 'muted';

interface Lists {
  hideFrom: MomentPerson[];
  muted: MomentPerson[];
}

const ROOT: CSSProperties = {
  paddingTop: `calc(var(--safe-top) + ${HEADER_HEIGHT}px)`,
  paddingLeft: 'var(--safe-left)',
  paddingRight: 'var(--safe-right)',
};

const OFF: Record<ListKind, UpdateMomentRelationBody> = {
  hideFrom: { hideFrom: false },
  muted: { mute: false },
};

function PersonRow({ person, onRemove }: { person: MomentPerson; onRemove(): void }) {
  const tr = useTr();
  return (
    <li className="flex items-center bg-white pl-4">
      <Link to={`/directory/${encodeURIComponent(person.id)}`} className="flex min-w-0 flex-1 items-center gap-3 py-2 active:opacity-70">
        <MemberAvatar name={person.displayName} avatarKey={person.avatarKey} shape="square" className="h-10 w-10 text-sm" />
        <span className="min-w-0 flex-1 truncate text-[17px] text-wx-ink">{person.displayName}</span>
      </Link>
      <button
        type="button"
        onClick={onRemove}
        aria-label={tr(`移除 ${person.displayName}`, `Remove ${person.displayName}`)}
        className="flex min-h-14 shrink-0 items-center px-4"
      >
        <span className="rounded-[4px] border-[0.5px] border-wx-line bg-wx-bar px-3 py-1 text-[14px] text-wx-ink active:bg-wx-pressed">{tr('移除', 'Remove')}</span>
      </button>
    </li>
  );
}

function PeopleSection({ title, people, onRemove }: { title: string; people: MomentPerson[]; onRemove(person: MomentPerson): void }) {
  const tr = useTr();
  return (
    <section aria-label={title}>
      <h2 className="px-4 pb-2 pt-5 text-[14px] leading-5 text-wx-meta">{title}</h2>
      {people.length === 0 ? (
        <p className="bg-white px-4 py-4 text-[15px] text-wx-meta">{tr('还没有设置', 'Nothing set')}</p>
      ) : (
        <ul className="divide-y-[0.5px] divide-wx-line bg-white">
          {people.map((person) => (
            <PersonRow key={person.id} person={person} onRemove={() => onRemove(person)} />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * /discover/feed/settings (动态设置): the 不让TA看我的动态 and 不看TA的动态 lists with [移除]; additions are made on a member's profile.
 * /discover/feed/settings（动态设置）：「不让TA看我的动态」和「不看TA的动态」两个列表，可「移除」；添加在成员资料页进行。
 */
export function MomentSettingsPage() {
  const tr = useTr();
  const navigationType = useNavigationType();
  const meId = useSessionStore((s) => s.member?.id ?? null);
  const goBack = useMomentsBack(meId ? `/discover/feed/member/${encodeURIComponent(meId)}` : '/discover/feed');
  const [freshVisit] = useState(() => navigationType !== 'POP');
  const [lists, setLists] = useState<Lists | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useStatusBarColor(WX_COLORS.canvas);

  // A short page, so a fresh visit simply starts at the top.
  // 页面很短，因此新的访问直接从顶部开始。
  useLayoutEffect(() => {
    if (freshVisit) window.scrollTo(0, 0);
  }, [freshVisit]);

  const load = useCallback(() => {
    setError(null);
    momentsApi.blocks().then(
      (res) => {
        if (mounted.current) setLists({ hideFrom: res.hideFrom, muted: res.muted });
      },
      (err: unknown) => {
        if (mounted.current) setError(errorMessage(err));
      },
    );
  }, []);

  useEffect(() => {
    mounted.current = true;
    load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  async function remove(kind: ListKind, person: MomentPerson) {
    if (!lists) return;
    const index = lists[kind].findIndex((item) => item.id === person.id);
    if (index === -1) return;
    // The row leaves at once, so it cannot be sent twice, and comes back at the same place, with a toast, if the
    // server refuses.
    // 这一行立即移除，因此不会重复发送；服务器拒绝时放回原处并提示。
    setLists((current) => (current ? { ...current, [kind]: current[kind].filter((item) => item.id !== person.id) } : current));
    try {
      await momentsApi.updateRelation(person.id, OFF[kind]);
    } catch (err) {
      if (!mounted.current) return;
      setLists((current) => {
        if (!current || current[kind].some((item) => item.id === person.id)) return current;
        const restored = [...current[kind]];
        restored.splice(Math.min(index, restored.length), 0, person);
        return { ...current, [kind]: restored };
      });
      toast(errorMessage(err));
    }
  }

  let body;
  if (lists) {
    body = (
      <>
        <PeopleSection title={tr('不让TA看我的动态', 'Hide my updates from them')} people={lists.hideFrom} onRemove={(person) => void remove('hideFrom', person)} />
        <PeopleSection title={tr('不看TA的动态', 'Hide their updates')} people={lists.muted} onRemove={(person) => void remove('muted', person)} />
        <p className="px-4 pb-[max(24px,var(--safe-bottom))] pt-3 text-[13px] leading-5 text-wx-meta">
          {tr('要添加，请打开对方的资料页，在「动态权限」中设置。', "To add someone, open their profile and use Update privacy.")}
        </p>
      </>
    );
  } else if (error) {
    body = <FeedError message={error} onRetry={load} />;
  } else {
    body = (
      <div className="flex justify-center py-16">
        <WxSpinner />
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-wx-canvas" style={ROOT}>
      <MomentsHeader variant="solid" title={tr('动态设置', 'Update settings')} backLabel={tr('相册', 'Album')} onBack={goBack} />
      <main className="mx-auto max-w-2xl">{body}</main>
    </div>
  );
}
