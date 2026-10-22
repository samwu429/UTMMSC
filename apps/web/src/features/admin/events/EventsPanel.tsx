import { useEffect, useState, type FormEvent } from 'react';
import type { EventRecord } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { formatEventTime } from '../../../shared/format/time';
import { useTr } from '../../../shared/i18n/locale';
import { Button } from '../../../shared/ui/Button';
import { Card, EmptyState, Notice } from '../../../shared/ui/Card';
import { useConfirm } from '../../../shared/ui/confirm';
import { Field, TextArea, TextInput } from '../../../shared/ui/Field';
import { adminApi } from '../api';

export function EventsPanel() {
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [title, setTitle] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ask = useConfirm();
  const tr = useTr();

  useEffect(() => {
    adminApi.events().then((res) => setEvents(res.events)).catch((err) => setError(errorMessage(err)));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await adminApi.createEvent({
        title,
        startsAt: new Date(startsAt).toISOString(),
        location: location || undefined,
        description: description || undefined,
      });
      setEvents((prev) => [res.event, ...prev]);
      setTitle('');
      setStartsAt('');
      setLocation('');
      setDescription('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(event: EventRecord) {
    const ok = await ask({ title: tr('删除这个活动？', 'Delete this event?'), body: event.title, confirmLabel: tr('删除', 'Delete'), danger: true });
    if (!ok) return;
    try {
      await adminApi.deleteEvent(event.id);
      setEvents((prev) => prev.filter((e) => e.id !== event.id));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="mb-3 font-semibold">{tr('新增活动', 'New event')}</h2>
        <form onSubmit={submit} className="space-y-3">
          <Field label={tr('活动名称', 'Event name')}>
            <TextInput value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
          </Field>
          <Field label={tr('开始时间', 'Start time')}>
            <TextInput type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          </Field>
          <Field label={tr('地点（选填）', 'Location (optional)')}>
            <TextInput value={location} onChange={(e) => setLocation(e.target.value)} maxLength={120} />
          </Field>
          <Field label={tr('说明（选填）', 'Description (optional)')}>
            <TextArea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} />
          </Field>
          {error ? <Notice tone="error">{error}</Notice> : null}
          <Button type="submit" block loading={busy} disabled={!title.trim() || !startsAt}>
            {tr('保存活动', 'Save event')}
          </Button>
        </form>
      </Card>
      {events.length === 0 ? (
        <EmptyState>{tr('还没有活动', 'No events yet')}</EmptyState>
      ) : (
        <div className="space-y-2">
          {events.map((event) => (
            <div key={event.id} className="flex items-start justify-between gap-2 rounded-xl bg-white px-4 py-3 ring-1 ring-stone-200">
              <div className="min-w-0">
                <p className="truncate font-medium">{event.title}</p>
                <p className="text-xs text-slate-500">
                  {formatEventTime(event.startsAt)}
                  {event.location ? ` · ${event.location}` : ''}
                </p>
              </div>
              <button onClick={() => remove(event)} className="shrink-0 text-sm text-red-600">
                {tr('删除', 'Delete')}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
