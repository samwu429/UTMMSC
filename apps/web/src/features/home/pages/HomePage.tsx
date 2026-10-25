import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { isHonoraryRole, showsEnrollment } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { useLabels } from '../../../shared/i18n/locale';
import { formatEventTime } from '../../../shared/format/time';
import { AndroidAppBanner } from '../../../shared/native/AndroidAppBanner';
import { useSessionStore } from '../../../shared/session/store';
import { EmptyState, List, Notice, Spinner } from '../../../shared/ui/Card';
import { MemberAvatar } from '../../profile/InitialAvatar';
import { TodayCard } from '../../timetable/home/TodayCard';
import { homeApi } from '../api';
import { forgetDaily, initialDaily, needsRefresh, presentDaily, rememberDaily, type CachedDaily } from '../dailyCache';

// Sign-out or a member switch removes the saved daily card, as the other caches on this device do.
// 退出登录或切换成员时删除保存的每日卡片，与这台设备上的其他缓存一致。
useSessionStore.subscribe((state, prev) => {
  const signedOut = prev.token !== null && state.token === null;
  const switched = prev.member !== null && state.member !== null && prev.member.id !== state.member.id;
  if (signedOut || switched) forgetDaily();
});

/**
 * Home: the header, 今日课表, today's weather and the club's upcoming events. The daily card shows the last data at
 * once, from this session or the device, and refreshes in the background; a spinner appears only when there is
 * nothing to show yet.
 * 首页：标题、今日课表、今天的天气和社团近期活动。每日卡片立即显示上次的内容（来自本次使用或这台设备），并在后台刷新；
 * 只有在还没有任何内容可显示时才出现加载圈。
 */
export function HomePage() {
  const { tr, role, enrollment, year, major, locale } = useLabels();
  const member = useSessionStore((s) => s.member);
  const memberId = member?.id ?? null;
  const programs = member ? major(member.major) : null;
  const [entry, setEntry] = useState<CachedDaily | null>(() => (memberId ? initialDaily(memberId, locale) : null));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const cached = memberId ? initialDaily(memberId, locale) : null;
    setEntry(cached);
    setError(null);
    if (!needsRefresh(cached)) return;
    let cancelled = false;
    homeApi
      .daily(locale)
      .then((card) => {
        if (cancelled) return;
        const fresh: CachedDaily = { card, lang: locale, savedAt: Date.now() };
        if (memberId) rememberDaily(memberId, fresh);
        setEntry(fresh);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [memberId, locale]);

  const shown = useMemo(() => (entry ? presentDaily(entry) : null), [entry]);
  const card = shown?.card ?? null;
  // Yesterday's weather is not shown as today's; it waits for the refresh.
  // 昨天的天气不会当作今天的显示，而是等待刷新。
  const weatherPending = Boolean(shown?.staleDay) && !error;

  return (
    <div>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <img src={`${import.meta.env.BASE_URL}brand/logo-horizontal.svg`} alt="UTMMSC" className="h-auto w-44" />
          <p className="mt-5 text-[13px] text-brand-700">{card ? `${card.weekday} · ${tr('多伦多', 'Toronto')}` : tr('多伦多', 'Toronto')}</p>
          {member?.headline ? <p className="mt-1 truncate text-sm text-stone-600">{member.headline}</p> : null}
          <span className="mt-3 block h-[3px] w-10 bg-gold" />
        </div>
        {member ? (
          <Link to="/settings" className="flex shrink-0 items-center gap-2 pt-0.5">
            <span className="max-w-[6.5rem] text-right leading-tight">
              <span className="block truncate text-[13px] font-medium text-brand-800">{member.displayName}</span>
              <span className="mt-0.5 block truncate text-[11px] text-stone-500">
                {showsEnrollment(member.role)
                  ? `${year(member.graduationYear)} · ${isHonoraryRole(member.role) ? role(member.role) : enrollment(member.enrollmentStatus)}${programs ? ` · ${programs}` : ''}`
                  : role(member.role)}
              </span>
            </span>
            <MemberAvatar name={member.displayName} avatarKey={member.avatarKey} className="h-11 w-11 text-base" />
          </Link>
        ) : null}
      </header>

      <AndroidAppBanner />

      <TodayCard />

      {error && !card ? (
        <div className="mt-4">
          <Notice tone="error">{error}</Notice>
        </div>
      ) : null}
      {!card && !error ? <Spinner /> : null}

      {card ? (
        <section className="-mx-4 mt-5 bg-white px-4 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm text-brand-700">{card.date}</p>
              {weatherPending ? (
                <div aria-busy="true" aria-label={tr('正在更新天气', 'Updating the weather')}>
                  <div className="mt-2 h-10 w-20 rounded bg-stone-100 motion-safe:animate-pulse" />
                  <div className="mt-2 h-4 w-32 rounded bg-stone-100 motion-safe:animate-pulse" />
                </div>
              ) : card.weather && !shown?.staleDay ? (
                <>
                  <p className="mt-1 text-[40px] font-semibold leading-none tracking-tight text-brand-800">{card.weather.temperatureC}°</p>
                  <p className="mt-2 text-sm text-brand-700">
                    {card.weather.description}
                    <span className="text-stone-400"> · {tr('体感', 'Feels like')} {card.weather.apparentC}°</span>
                  </p>
                </>
              ) : (
                <p className="mt-2 text-sm text-stone-500">{tr('天气暂时取不到', 'Weather is unavailable')}</p>
              )}
            </div>
            {card.weather && card.weather.precipitationChance !== null && !shown?.staleDay ? (
              <p className="pt-1 text-right text-sm text-stone-500">
                {tr('降水', 'Rain')}
                <span className="mt-0.5 block text-base font-medium text-stone-800">{card.weather.precipitationChance}%</span>
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="mt-7">
        <h2 className="mb-2 text-[15px] font-medium text-brand-800">{tr('近期活动', 'Upcoming events')}</h2>
        {!card ? null : card.events.length === 0 ? (
          <EmptyState>{tr('主席团还没有录入活动', 'The presidium has not added any events')}</EmptyState>
        ) : (
          <List>
            {card.events.map((event) => (
              <div key={event.id} className="px-4 py-3">
                <p className="font-medium">{event.title}</p>
                <p className="mt-0.5 text-sm text-stone-500">
                  {formatEventTime(event.startsAt)}
                  {event.location ? ` · ${event.location}` : ''}
                </p>
                {event.description ? <p className="mt-1 whitespace-pre-wrap text-sm text-stone-700">{event.description}</p> : null}
              </div>
            ))}
          </List>
        )}
      </section>
    </div>
  );
}
