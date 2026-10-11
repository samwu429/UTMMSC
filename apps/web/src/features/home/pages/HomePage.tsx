import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DailyCardResponse } from '@utmmsc/shared';
import { ENROLLMENT_LABELS, ROLE_LABELS } from '@utmmsc/shared';
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
      <header>
        <p className="text-[13px] text-stone-500">{card ? `${card.weekday} · 多伦多` : '多伦多'}</p>
        <h1 className="mt-1 text-[26px] font-semibold tracking-tight">{member?.displayName}</h1>
        {member ? (
          <p className="mt-1 text-sm text-stone-500">
            {member.graduationYear} 届 · {ENROLLMENT_LABELS[member.enrollmentStatus]} · {ROLE_LABELS[member.role]}
          </p>
        ) : null}
      </header>

      {error ? <div className="mt-4"><Notice tone="error">{error}</Notice></div> : null}
      {!card && !error ? <Spinner /> : null}

      {card ? (
        <section className="mt-5 rounded-xl bg-white px-4 py-4 ring-1 ring-stone-200">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm text-stone-500">{card.date}</p>
              {card.weather ? (
                <>
                  <p className="mt-1 text-[34px] font-semibold leading-none tracking-tight">{card.weather.temperatureC}°</p>
                  <p className="mt-2 text-sm text-stone-600">
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
        <h2 className="mb-2 text-[13px] font-medium text-stone-500">近期活动</h2>
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
        <h2 className="mb-2 text-[13px] font-medium text-stone-500">常用</h2>
        <List>
          <Link to="/chat" className="flex items-center justify-between px-4 py-3.5 active:bg-stone-50">
            <span>
              <span className="block font-medium">聊天</span>
              <span className="text-sm text-stone-500">频道和私聊</span>
            </span>
            <span className="text-stone-300">›</span>
          </Link>
          <Link to="/directory" className="flex items-center justify-between px-4 py-3.5 active:bg-stone-50">
            <span>
              <span className="block font-medium">成员</span>
              <span className="text-sm text-stone-500">按届别和专业找人</span>
            </span>
            <span className="text-stone-300">›</span>
          </Link>
        </List>
      </section>
    </div>
  );
}
