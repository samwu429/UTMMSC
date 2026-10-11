import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DailyCardResponse } from '@utmmsc/shared';
import { ROLE_LABELS } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { formatEventTime } from '../../../shared/format/time';
import { useSessionStore } from '../../../shared/session/store';
import { Badge, Card, EmptyState, Notice, Spinner } from '../../../shared/ui/Card';
import { homeApi } from '../api';

export function HomePage() {
  const member = useSessionStore((s) => s.member);
  const [card, setCard] = useState<DailyCardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    homeApi.daily().then(setCard).catch((err) => setError(errorMessage(err)));
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-slate-500">你好</p>
        <h1 className="text-2xl font-semibold">
          {member?.displayName} <Badge tone="brand">{member ? ROLE_LABELS[member.role] : ''}</Badge>
        </h1>
      </div>

      {error ? <Notice tone="error">{error}</Notice> : null}
      {!card && !error ? <Spinner /> : null}

      {card ? (
        <>
          <Card className="bg-gradient-to-br from-brand-800 to-brand-600 text-white">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="inline-block rounded-full bg-accent-400 px-2.5 py-0.5 text-xs font-semibold text-brand-900">{card.weekday}</p>
                <p className="mt-2 text-3xl font-semibold tracking-tight">{card.date}</p>
              </div>
              {card.weather ? (
                <div className="text-right">
                  <p className="text-3xl font-semibold">{card.weather.temperatureC}°</p>
                  <p className="text-sm opacity-90">
                    {card.weather.description} · 体感 {card.weather.apparentC}°
                  </p>
                  {card.weather.precipitationChance !== null ? <p className="text-xs opacity-80">降水概率 {card.weather.precipitationChance}%</p> : null}
                </div>
              ) : (
                <p className="text-sm opacity-80">天气暂不可用</p>
              )}
            </div>
            <p className="mt-3 text-xs opacity-80">多伦多</p>
          </Card>

          <section>
            <h2 className="mb-2 text-base font-semibold">近期活动</h2>
            {card.events.length === 0 ? (
              <EmptyState>暂无活动安排</EmptyState>
            ) : (
              <div className="space-y-2">
                {card.events.map((event) => (
                  <Card key={event.id}>
                    <p className="font-medium">{event.title}</p>
                    <p className="text-sm text-slate-500">{formatEventTime(event.startsAt)}</p>
                    {event.location ? <p className="text-sm text-slate-500">{event.location}</p> : null}
                    {event.description ? <p className="mt-1 whitespace-pre-wrap text-sm">{event.description}</p> : null}
                  </Card>
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}

      <section className="grid grid-cols-2 gap-3">
        <Link to="/chat" className="rounded-2xl bg-white p-4 shadow-sm shadow-brand-900/5 active:scale-[0.98]">
          <span className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-accent-400 text-sm font-bold text-brand-900">聊</span>
          <p className="text-lg font-semibold">聊天</p>
          <p className="text-sm text-slate-500">频道与私聊</p>
        </Link>
        <Link to="/directory" className="rounded-2xl bg-white p-4 shadow-sm shadow-brand-900/5 active:scale-[0.98]">
          <span className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-brand-700 text-sm font-bold text-accent-300">名</span>
          <p className="text-lg font-semibold">成员</p>
          <p className="text-sm text-slate-500">按届别查找</p>
        </Link>
      </section>
    </div>
  );
}
