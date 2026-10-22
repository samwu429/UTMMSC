import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DailyCardResponse } from '@utmmsc/shared';
import { isHonoraryRole, showsEnrollment } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { useLabels } from '../../../shared/i18n/locale';
import { formatEventTime } from '../../../shared/format/time';
import { useSessionStore } from '../../../shared/session/store';
import { EmptyState, List, Notice, Spinner } from '../../../shared/ui/Card';
import { MemberAvatar } from '../../profile/InitialAvatar';
import { homeApi } from '../api';

export function HomePage() {
  const { tr, role, enrollment, year, major, locale } = useLabels();
  const member = useSessionStore((s) => s.member);
  const programs = member ? major(member.major) : null;
  const [card, setCard] = useState<DailyCardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    homeApi
      .daily(locale)
      .then((res) => {
        if (cancelled) return;
        setCard(res);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [locale]);

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

      {error ? <div className="mt-4"><Notice tone="error">{error}</Notice></div> : null}
      {!card && !error ? <Spinner /> : null}

      {card ? (
        <section className="-mx-4 mt-5 bg-white px-4 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm text-brand-700">{card.date}</p>
              {card.weather ? (
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
            {card.weather?.precipitationChance !== null && card.weather ? (
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
