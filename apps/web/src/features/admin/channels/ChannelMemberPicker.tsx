import { memo, useDeferredValue, useMemo, useState } from 'react';
import { ROLE_LABELS, type AdminMemberRow } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { useLabels } from '../../../shared/i18n/locale';
import { toast } from '../../../shared/ui/toast';
import { MemberAvatar } from '../../profile/InitialAvatar';
import { AdminScreen, useAdminBack } from '../layout/AdminScreen';
import { useInsetGroups } from '../layout/media';
import { useMembers } from '../members/memberData';
import { MEMBER_PAGE } from '../members/MemberList';
import { groupMembers, limitGroups, matchesQuery, searchText } from '../members/memberRules';
import { AdminCell, AdminGroup } from '../ui/AdminCell';
import { EmptyBlock, LoadFailed } from '../ui/Feedback';
import { useRoleNames } from '../ui/labels';
import { ListSkeleton } from '../ui/ListSkeleton';
import { useAdminConfirm } from '../ui/overlayGate';
import { SearchBar } from '../ui/SearchBar';
import { saveChannel } from './channelData';
import { audienceLabel, memberPickerSave } from './channelForm';
import { HEADER_ACTION, useChannelPaths, useChannelScreen } from './channelParts';

const PickRow = memo(function PickRow({ member, detail, checked, onToggle }: { member: AdminMemberRow; detail: string; checked: boolean; onToggle: (id: string, next: boolean) => void }) {
  return (
    <AdminCell
      rowId={member.id}
      lazy
      checkbox={{ checked, onChange: (next) => onToggle(member.id, next) }}
      leading={<MemberAvatar name={member.displayName} avatarKey={member.avatarKey} shape="square" className="h-10 w-10 text-sm" />}
      label={member.displayName}
      detail={detail}
    />
  );
});

/**
 * 成员 of a custom channel, /admin/channels/:id/members, like WeChat's 选择联系人: search, the people picked so far as a
 * strip of avatars at the top (a tap takes one out), the active members grouped by role group with 全选 per group,
 * and 完成（n）. Taking people out asks first, since they lose access at once; the list is saved in full. Reached from
 * 谁能看到 for a channel that is not custom yet, it starts empty, and 完成 asks about narrowing and then makes the channel
 * custom with this list in one request; leaving changes nothing.
 * 指定成员频道的「成员」，/admin/channels/:id/members，与微信「选择联系人」一致：搜索；顶部是已选成员的头像条（点按即移出）；在用成员按身份分组，
 * 每组可「全选」；以及「完成（n）」。移出成员前会先询问，因为他们会立刻失去访问权限；名单整体保存。从「谁能看到」为尚不是指定成员的频道进入时，
 * 选择从空开始，「完成」先确认收窄范围，再在一次请求中把频道改为指定成员并保存名单；中途离开不会改动频道。
 */
export function ChannelMemberPicker({ id }: { id: string }) {
  const { tr, group, locale } = useLabels();
  const roleNames = useRoleNames();
  const goBack = useAdminBack();
  const confirm = useAdminConfirm();
  const insetGroups = useInsetGroups();
  const { settings, settingsBack } = useChannelPaths(id);
  const { channel, fallback } = useChannelScreen(id);
  const members = useMembers();
  const [picked, setPicked] = useState<ReadonlySet<string> | null>(null);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(MEMBER_PAGE);
  const [busy, setBusy] = useState(false);
  const deferredQuery = useDeferredValue(query);
  // A new search starts again from the first page.
  // 新的搜索从第一页重新开始。
  const [limitFor, setLimitFor] = useState(query);
  if (limitFor !== query) {
    setLimitFor(query);
    setLimit(MEMBER_PAGE);
  }

  // Until the first tap the selection is the channel's own list, so it follows the server until then. A channel that
  // is not custom yet has no list, so it starts empty.
  // 第一次点按之前，选择就是频道自己的名单，因此在那之前跟随服务器的数据。尚不是指定成员的频道没有名单，因此从空开始。
  const chosen = useMemo(() => picked ?? new Set(channel?.memberIds ?? []), [picked, channel]);
  const active = useMemo(() => (members.data ?? []).filter((member) => member.status === 'active'), [members.data]);
  const byId = useMemo(() => new Map((members.data ?? []).map((member) => [member.id, member])), [members.data]);
  const index = useMemo(() => active.map((member) => ({ member, text: searchText(member, (role) => [ROLE_LABELS[role], roleNames[role]]) })), [active, roleNames]);
  const groups = useMemo(
    () => groupMembers(index.filter((entry) => matchesQuery(entry.text, deferredQuery)).map((entry) => entry.member), locale),
    [index, deferredQuery, locale],
  );
  const { groups: shown, hidden } = limitGroups(groups, limit);
  const strip = useMemo(() => [...chosen].map((memberId) => byId.get(memberId)).filter((member): member is AdminMemberRow => member !== undefined), [chosen, byId]);

  function toggle(memberId: string, next: boolean) {
    setPicked((current) => {
      const set = new Set(current ?? channel?.memberIds ?? []);
      if (next) set.add(memberId);
      else set.delete(memberId);
      return set;
    });
  }

  function setGroup(ids: readonly string[], next: boolean) {
    setPicked((current) => {
      const set = new Set(current ?? channel?.memberIds ?? []);
      for (const memberId of ids) {
        if (next) set.add(memberId);
        else set.delete(memberId);
      }
      return set;
    });
  }

  async function done() {
    if (!channel || busy || chosen.size === 0) return;
    const plan = memberPickerSave(channel, [...chosen]);
    if (plan.ask === 'narrow') {
      const label = audienceLabel('custom');
      const ok = await confirm({
        title: tr(`改为${label.zh}？`, `Change to ${label.en}?`),
        body: tr('不在新范围内的成员会立刻看不到这个频道。', 'Members outside the new audience lose access right away.'),
        confirmLabel: tr('改为', 'Change'),
      });
      if (!ok) return;
    } else if (plan.ask === 'remove') {
      const n = plan.removed;
      const ok = await confirm({
        title: tr(`移出 ${n} 人？`, `Remove ${n} ${n === 1 ? 'person' : 'people'}?`),
        body: tr('他们会立刻看不到这个频道。', 'They lose access right away.'),
        confirmLabel: tr('移出', 'Remove'),
        danger: true,
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const saved = await saveChannel(channel, plan.change);
      if (saved !== channel) toast(tr('已保存', 'Saved'));
      goBack(settings);
    } catch (err) {
      toast(errorMessage(err));
      setBusy(false);
    }
  }

  const trailing = channel ? (
    <button type="button" onClick={() => void done()} disabled={busy || chosen.size === 0} className={HEADER_ACTION}>
      {busy ? tr('保存中…', 'Saving…') : tr(`完成（${chosen.size}）`, `Done (${chosen.size})`)}
    </button>
  ) : null;

  const sub = channel ? (
    <>
      {strip.length > 0 ? (
        <div className="flex gap-2 overflow-x-auto bg-white px-3 pb-1 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label={tr('已选成员', 'Picked members')}>
          {strip.map((member) => (
            <button
              key={member.id}
              type="button"
              onClick={() => toggle(member.id, false)}
              aria-label={tr(`移出${member.displayName}`, `Take out ${member.displayName}`)}
              className="flex min-h-11 w-12 shrink-0 flex-col items-center gap-0.5 rounded-md active:bg-stone-100"
            >
              <MemberAvatar name={member.displayName} avatarKey={member.avatarKey} shape="square" className="h-9 w-9 text-xs" />
              <span className="w-full truncate text-center text-[11px] leading-4 text-stone-600">{member.displayName}</span>
            </button>
          ))}
        </div>
      ) : null}
      <SearchBar value={query} onChange={setQuery} placeholder={tr('搜索姓名、邮箱或身份', 'Search name, email, or role')} />
    </>
  ) : undefined;

  let body;
  if (!channel) body = fallback;
  else if (!members.data) body = members.error ? <LoadFailed error={members.error} onRetry={() => void members.refresh()} /> : <ListSkeleton rows={6} avatar />;
  else if (groups.length === 0) {
    body = (
      <EmptyBlock
        title={deferredQuery.trim() ? tr(`没有找到「${deferredQuery.trim()}」`, `No members match "${deferredQuery.trim()}"`) : tr('还没有在用的成员', 'No active members yet')}
      />
    );
  } else {
    const side = insetGroups ? 'px-1' : 'px-4';
    body = (
      <>
        {members.error ? <LoadFailed error={members.error} onRetry={() => void members.refresh()} /> : null}
        {shown.map((item) => {
          const full = groups.find((entry) => entry.label === item.label)?.members ?? item.members;
          const ids = full.map((member) => member.id);
          const all = ids.every((memberId) => chosen.has(memberId));
          return (
            <section key={item.label} className={insetGroups ? 'mt-5 first:mt-0' : 'mt-2'}>
              <div className={`flex items-center justify-between ${side}`}>
                <h2 className="pb-1 pt-2 text-[13px] leading-5 text-wx-meta">{`${group(item.label)} ${full.length}`}</h2>
                <button type="button" onClick={() => setGroup(ids, !all)} className="min-h-11 rounded-lg px-2 text-[14px] font-medium text-brand-800 active:bg-stone-200/60">
                  {all ? tr('取消全选', 'Clear all') : tr('全选', 'Select all')}
                </button>
              </div>
              <AdminGroup inset="avatar">
                {item.members.map((member) => (
                  <PickRow
                    key={member.id}
                    member={member}
                    detail={`${roleNames[member.role]} · ${member.email}`}
                    checked={chosen.has(member.id)}
                    onToggle={toggle}
                  />
                ))}
              </AdminGroup>
            </section>
          );
        })}
        {hidden > 0 ? (
          <div className="flex justify-center pt-3">
            <button type="button" onClick={() => setLimit((current) => current + MEMBER_PAGE)} className="min-h-11 rounded-lg px-4 text-[15px] font-medium text-brand-800 active:bg-stone-200/60">
              {tr(`显示更多（还有 ${hidden} 人）`, `Show more (${hidden} more)`)}
            </button>
          </div>
        ) : null}
        <p className={`pt-3 text-[13px] leading-relaxed text-wx-meta ${side}`}>
          {tr('只列出在用的成员。能管理频道的人始终看得到这个频道。', 'Only active members are listed. People who manage channels always see this channel.')}
        </p>
      </>
    );
  }

  return (
    <AdminScreen title={tr('选择成员', 'Choose members')} back={settingsBack} escapeTo={settings} trailing={trailing} sub={sub}>
      {body}
    </AdminScreen>
  );
}
