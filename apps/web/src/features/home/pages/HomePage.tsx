import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DailyCardResponse } from '@utmmsc/shared';
import { ENROLLMENT_LABELS, ROLE_LABELS, isStaffRole } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { formatEventTime } from '../../../shared/format/time';
import { useSessionStore } from '../../../shared/session/store';
import { EmptyState, List, Notice, Spinner } from '../../../shared/ui/Card';
import { homeApi } from '../api';

export function HomePage() {
  const member = useSessionStore((s) => s.member);
  const [card, setCard] = useState<DailyCardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    homeApi.daily().then(setCard).catch((err) => setError(errorMessage(err)));
  }, []);

  return (
    <div>
      <img src={`${import.meta.env.BASE_URL}brand/logo-horizontal.svg`} alt="UTMMSC" className="mb-6 h-auto w-56" />
      <header>
        <p className="text-[13px] text-brand-700">{card ? `${card.weekday} · 多伦多` : '多伦多'}</p>
        <h1 className="mt-1 text-[26px] font-semibold tracking-tight text-brand-800">{member?.displayName}</h1>
        {member?.headline ? <p className="mt-1 text-sm text-stone-600">{member.headline}</p> : null}
        {member ? (
          <p className="mt-1 text-sm text-stone-500">
            {member.graduationYear} 届 · {ENROLLMENT_LABELS[member.enrollmentStatus]}
            {isStaffRole(member.role) ? ` · ${ROLE_LABELS[member.role]}` : ''}
          </p>
        ) : null}
        {member && !member.headline ? (
          <Link to="/settings" className="mt-2 inline-block text-sm text-brand-800">
            填写一句话介绍
          </Link>
        ) : null}
        <span className="mt-3 block h-[3px] w-10 bg-gold" />
      </header>

      {error ? <div className="mt-4"><Notice tone="error">{error}</Notice></div> : null}
      {!card && !error ? <Spinner /> : null}

      {card ? (
        <section className="mt-5 bg-white px-4 py-4 ring-1 ring-stone-200">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm text-brand-700">{card.date}</p>
              {card.weather ? (
                <>
                  <p className="mt-1 text-[40px] font-semibold leading-none tracking-tight text-brand-800">{card.weather.temperatureC}°</p>
                  <p className="mt-2 text-sm text-brand-700">
                    {card.weather.description}
                    <span className="text-stone-400"> · 体感 {card.weather.apparentC}°</span>
                  </p>
                </>
              ) : (
                <p className="mt-2 text-sm text-stone-500">天气暂时取不到</p>
              )}
            </div>
            {card.weather?.precipitationChance !== null && card.weather ? (
              <p className="pt-1 text-right text-sm text-stone-500">
                降水
                <span className="mt-0.5 block text-base font-medium text-stone-800">{card.weather.precipitationChance}%</span>
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="mt-7">
        <h2 className="mb-2 text-[15px] font-medium text-brand-800">近期活动</h2>
        {!card || card.events.length === 0 ? (
          <EmptyState>主席团还没有录入活动</EmptyState>
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

      <section className="mt-7">
        <h2 className="mb-2 text-[15px] font-medium text-brand-800">常用</h2>
        <List>
          <Link to="/chat" className="flex items-center justify-between px-4 py-3.5 active:bg-stone-50">
            <span>
              <span className="block font-medium">聊天</span>
              <span className="text-sm text-stone-500">频道、私聊和成员</span>
            </span>
            <span className="text-stone-300">›</span>
          </Link>
          <Link to="/discover" className="flex items-center justify-between px-4 py-3.5 active:bg-stone-50">
            <span>
              <span className="block font-medium">发现</span>
              <span className="text-sm text-stone-500">好友动态和文件</span>
            </span>
            <span className="text-stone-300">›</span>
          </Link>
        </List>
      </section>
    </div>
  );
}
