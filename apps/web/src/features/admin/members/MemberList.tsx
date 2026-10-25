import { memo, useDeferredValue, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { ROLE_LABELS, showsEnrollment, type AdminMemberRow } from '@utmmsc/shared';
import { useLabels } from '../../../shared/i18n/locale';
import { MemberAvatar } from '../../profile/InitialAvatar';
import { AdminScreen, useSectionBack } from '../layout/AdminScreen';
import { useListKeyboard } from '../layout/listKeyboard';
import { useInsetGroups, useIsWide } from '../layout/media';
import { AdminCell, AdminGroup } from '../ui/AdminCell';
import { FilterChips } from '../ui/Choices';
import { EmptyBlock, LoadFailed } from '../ui/Feedback';
import { useRoleNames } from '../ui/labels';
import { ListSkeleton } from '../ui/ListSkeleton';
import { SearchBar } from '../ui/SearchBar';
import { StatusBadge } from '../ui/StatusBadge';
import { useMembers } from './memberData';
import {
  MEMBER_FILTERS,
  MEMBER_FILTER_LABELS,
  filterCounts,
  groupMembers,
  limitGroups,
  matchesFilter,
  matchesQuery,
  membersPath,
  readMemberFilter,
  searchText,
  type MemberFilter,
} from './memberRules';

/** Rows drawn at first and added per 显示更多, so a club of hundreds stays quick to type into. */
/** 首次绘制以及每次「显示更多」增加的行数，几百人的社团输入搜索时依然流畅。 */
export const MEMBER_PAGE = 50;

const MemberRow = memo(function MemberRow({ member, detail, to, replace, selected }: { member: AdminMemberRow; detail: string; to: string; replace: boolean; selected: boolean }) {
  const { tr } = useLabels();
  return (
    <AdminCell
      rowId={member.id}
      to={to}
      replace={replace}
      selected={selected}
      lazy
      leading={<MemberAvatar name={member.displayName} avatarKey={member.avatarKey} shape="square" className="h-10 w-10 text-sm" />}
      label={member.displayName}
      detail={detail}
      badge={
        member.status === 'disabled' ? (
          <StatusBadge tone="danger">{tr('已停用', 'Disabled')}</StatusBadge>
        ) : member.status === 'pending' ? (
          <StatusBadge tone="pending">{tr('未激活', 'Not active')}</StatusBadge>
        ) : null
      }
    />
  );
});

const ROLE_RULES: [string, string] = [
  '每个章程职位同时只能有一个人。荣誉顾问可以有多人，只有系统管理员能指定。主席可以任命部长和成员，不能任命其他主席团。你不能修改职位不低于你的成员，也不能修改自己的身份。入学年份只有系统管理员能改。',
  "Each office in the constitution is held by one person at a time. There can be several honorary advisors, and only a system administrator can assign them. The president can appoint department heads and members, but not other presidium members. You can't change members at or above your level, or your own role. Only a system administrator can change enrollment years.",
];

/**
 * 成员与身份: search across name, email and role, filter chips with counts, the list grouped by role group (highest
 * tier first), 50 rows at a time. Search and filter live in the address (?q=, ?f=) and ride along to each member's
 * screen, so the list beside or under it stays as it was.
 * 「成员与身份」：按姓名、邮箱和身份搜索，带计数的筛选标签，按身份分组的列表（最高档位在前），每次显示 50 行。搜索和筛选保存在地址中
 * （?q=、?f=），并随之带到每位成员的界面，旁边或下方的列表因此保持原样。
 */
export function MemberList({ selectedId }: { selectedId: string | null }) {
  const { tr, year, enrollment, group, locale } = useLabels();
  const roleNames = useRoleNames();
  const back = useSectionBack();
  const insetGroups = useInsetGroups();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const filter = readMemberFilter(params.get('f'));
  // Typing stays responsive: the list follows the query a moment later, at lower priority.
  // 输入保持流畅：列表稍后以较低的优先级跟上查询。
  const deferredQuery = useDeferredValue(query);
  const members = useMembers();
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useListKeyboard(listRef, searchRef);
  // In the split view, picking another member replaces the one shown, so back and Esc return to the list in one step.
  // 在分栏视图中，选择另一位成员会替换正在显示的一位，因此返回和 Esc 一步就回到列表。
  const swap = useIsWide() && selectedId !== null;

  const [limit, setLimit] = useState(MEMBER_PAGE);
  const [limitFor, setLimitFor] = useState(`${filter}\n${query}`);
  if (limitFor !== `${filter}\n${query}`) {
    setLimitFor(`${filter}\n${query}`);
    setLimit(MEMBER_PAGE);
  }

  const index = useMemo(
    () => (members.data ?? []).map((member) => ({ member, text: searchText(member, (role) => [ROLE_LABELS[role], roleNames[role]]) })),
    [members.data, roleNames],
  );
  const counts = useMemo(() => filterCounts(members.data ?? []), [members.data]);
  const groups = useMemo(
    () => groupMembers(index.filter((entry) => matchesFilter(entry.member, filter) && matchesQuery(entry.text, deferredQuery)).map((entry) => entry.member), locale),
    [index, filter, deferredQuery, locale],
  );
  const { groups: shown, hidden } = limitGroups(groups, limit);
  const total = groups.reduce((sum, item) => sum + item.members.length, 0);

  function update(key: 'q' | 'f', value: string) {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  }

  const chips = MEMBER_FILTERS.map((value) => ({ value, label: tr(MEMBER_FILTER_LABELS[value].zh, MEMBER_FILTER_LABELS[value].en), count: members.data ? counts[value] : null }));
  const sub = (
    <>
      <SearchBar ref={searchRef} value={query} onChange={(next) => update('q', next.trim() ? next : '')} placeholder={tr('搜索姓名、邮箱或身份', 'Search name, email, or role')} />
      <div className="pb-1.5">
        <FilterChips<MemberFilter> label={tr('筛选成员', 'Filter members')} options={chips} value={filter} onChange={(next) => update('f', next === 'all' ? '' : next)} />
      </div>
    </>
  );

  function detailOf(member: AdminMemberRow): string {
    const parts = [roleNames[member.role]];
    if (showsEnrollment(member.role)) parts.push(year(member.graduationYear), enrollment(member.enrollmentStatus));
    return parts.join(' · ');
  }

  let body;
  if (!members.data) {
    body = members.error ? <LoadFailed error={members.error} onRetry={() => void members.refresh()} /> : <ListSkeleton rows={6} avatar />;
  } else if (total === 0) {
    body = (
      <EmptyBlock
        title={
          deferredQuery.trim()
            ? tr(`没有找到「${deferredQuery.trim()}」`, `No members match "${deferredQuery.trim()}"`)
            : members.data.length === 0
              ? tr('还没有成员', 'No members yet')
              : tr('这里还没有成员', 'No one here yet')
        }
      />
    );
  } else {
    body = (
      <>
        {members.error ? <LoadFailed error={members.error} onRetry={() => void members.refresh()} /> : null}
        {shown.map((item) => {
          const size = groups.find((entry) => entry.label === item.label)?.members.length ?? item.members.length;
          return (
            <AdminGroup key={item.label} title={`${group(item.label)} ${size}`} inset="avatar">
              {item.members.map((member) => (
                <MemberRow
                  key={member.id}
                  member={member}
                  detail={detailOf(member)}
                  to={membersPath(member.id, location.search)}
                  replace={swap}
                  selected={member.id === selectedId}
                />
              ))}
            </AdminGroup>
          );
        })}
        {hidden > 0 ? (
          <div className="flex justify-center pt-3">
            <button
              type="button"
              onClick={() => setLimit((current) => current + MEMBER_PAGE)}
              className="min-h-11 rounded-lg px-4 text-[15px] font-medium text-brand-800 active:bg-stone-200/60"
            >
              {tr(`显示更多（还有 ${hidden} 人）`, `Show more (${hidden} more)`)}
            </button>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <AdminScreen title={tr('成员与身份', 'Members and roles')} count={members.data?.length ?? null} back={back} top sub={sub}>
      <div ref={listRef}>{body}</div>
      <details className={`mt-5 text-[13px] leading-relaxed text-wx-meta ${insetGroups ? 'px-1' : 'px-4'}`}>
        <summary className="flex min-h-11 cursor-pointer items-center font-medium text-brand-800">{tr('身份规则', 'Role rules')}</summary>
        <p className="pb-2">{tr(...ROLE_RULES)}</p>
      </details>
    </AdminScreen>
  );
}
