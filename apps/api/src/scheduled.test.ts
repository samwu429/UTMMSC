import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from './env';
import { runMomentsMaintenance } from './infrastructure/d1/moment-maintenance';
import { runStickerMaintenance } from './infrastructure/d1/sticker-maintenance';
import { runScheduledNotifications } from './infrastructure/push/event-notices';
import { runTimetableReminders } from './infrastructure/push/timetable-reminders';
import { EVENTS_CRON, STICKERS_CRON, TIMETABLE_CRON, runScheduledJob, scheduledJobs } from './scheduled';
import worker from './index';

// The jobs themselves are tested in their own files; here only which trigger runs which job.
// 各项工作本身在各自的文件中测试；这里只检查哪个触发器运行哪项工作。
vi.mock('./infrastructure/push/timetable-reminders', () => ({ runTimetableReminders: vi.fn(async () => undefined) }));
vi.mock('./infrastructure/push/event-notices', () => ({ runScheduledNotifications: vi.fn(async () => undefined) }));
vi.mock('./infrastructure/d1/moment-maintenance', () => ({ runMomentsMaintenance: vi.fn(async () => undefined) }));
vi.mock('./infrastructure/d1/sticker-maintenance', () => ({ runStickerMaintenance: vi.fn(async () => undefined) }));
// The Worker entry also exports the Durable Objects and builds the HTTP app; neither loads outside workerd.
// Worker 入口还导出 Durable Object 并创建 HTTP 应用；两者都无法在 workerd 之外加载。
vi.mock('./realtime/rooms/chat-room', () => ({ ChatRoom: class {} }));
vi.mock('./infrastructure/push/relay', () => ({ PushRelay: class {} }));
vi.mock('./http/app', () => ({ createApp: () => ({ fetch: vi.fn() }) }));

/**
 * The cron dispatch: the minute trigger runs only the timetable job and the hourly trigger only the sticker sweep,
 * each in an invocation of its own; every other trigger runs the five-minute jobs exactly as before the timetable
 * existed.
 * 定时任务的分派：每分钟的触发器只运行课表工作，每小时的触发器只运行表情清理，各自在单独的一次调用中运行；其他任何触发器都与课表出现之前完全一样，
 * 运行五分钟一次的工作。
 */

const env = { APP_BASE_URL: 'https://utmmsc.com/UTMMSC/' } as unknown as Env;

interface FsModule {
  readFileSync(path: URL, encoding: 'utf8'): string;
}

/** The cron strings in wrangler.jsonc. The API's tsconfig has Workers types only, so node:fs is loaded like sqlite-d1.ts does. */
/** wrangler.jsonc 中的 cron 字符串。接口的 tsconfig 只有 Workers 类型，因此像 sqlite-d1.ts 一样加载 node:fs。 */
function configuredCrons(): string[] | null {
  const proc = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process;
  const fs = proc?.getBuiltinModule?.('node:fs') as FsModule | undefined;
  if (!fs) return null;
  const config = fs.readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  const list = /"crons"\s*:\s*\[([^\]]*)\]/.exec(config)?.[1] ?? '';
  return [...list.matchAll(/"([^"]*)"/g)].map((match) => match[1] as string);
}

function controller(cron: string, scheduledTime: number): ScheduledController {
  return { cron, scheduledTime, noRetry: () => undefined } as ScheduledController;
}

function context() {
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: vi.fn((promise: Promise<unknown>) => void pending.push(promise)), passThroughOnException: vi.fn() };
  return { ctx: ctx as unknown as ExecutionContext, pending, waitUntil: ctx.waitUntil };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('scheduledJobs', () => {
  it('runs only the timetable job on the minute trigger', () => {
    expect(scheduledJobs(TIMETABLE_CRON)).toEqual(['timetable']);
    expect(scheduledJobs(' *  * * *\t* ')).toEqual(['timetable']);
  });

  it('runs only the sticker sweep on the hourly trigger', () => {
    expect(STICKERS_CRON).toBe('17 * * * *');
    expect(scheduledJobs('17 * * * *')).toEqual(['stickers']);
    expect(scheduledJobs(' 17 *  * * * ')).toEqual(['stickers']);
  });

  it('runs the five-minute jobs on every other trigger, including a manual run without a cron', () => {
    expect(scheduledJobs(EVENTS_CRON)).toEqual(['events', 'moments']);
    expect(scheduledJobs('')).toEqual(['events', 'moments']);
    expect(scheduledJobs('0 * * * *')).toEqual(['events', 'moments']);
    expect(scheduledJobs('7 * * * *')).toEqual(['events', 'moments']);
  });

  it('matches the triggers in wrangler.jsonc', () => {
    const crons = configuredCrons();
    if (!crons) return;
    expect([...crons].sort()).toEqual([EVENTS_CRON, TIMETABLE_CRON, STICKERS_CRON].sort());
  });
});

describe('runScheduledJob', () => {
  const now = new Date('2026-10-26T13:50:00.000Z');

  it('hands each job the cron time', async () => {
    await runScheduledJob('timetable', env, now);
    expect(runTimetableReminders).toHaveBeenCalledWith(env, now);
    expect(runScheduledNotifications).not.toHaveBeenCalled();
    await runScheduledJob('events', env, now);
    expect(runScheduledNotifications).toHaveBeenCalledWith(env, now);
    await runScheduledJob('moments', env, now);
    expect(runMomentsMaintenance).toHaveBeenCalledWith(env, now);
    expect(runStickerMaintenance).not.toHaveBeenCalled();
    await runScheduledJob('stickers', env, now);
    expect(runStickerMaintenance).toHaveBeenCalledWith(env, now);
    expect(runTimetableReminders).toHaveBeenCalledTimes(1);
  });
});

describe('the Worker scheduled handler', () => {
  const scheduledTime = Date.parse('2026-10-26T13:50:00.000Z');

  it('runs the timetable job alone for the minute trigger, from the scheduled time', async () => {
    const { ctx, pending, waitUntil } = context();
    await worker.scheduled(controller(TIMETABLE_CRON, scheduledTime), env, ctx);
    await Promise.all(pending);
    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(runTimetableReminders).toHaveBeenCalledWith(env, new Date(scheduledTime));
    expect(runScheduledNotifications).not.toHaveBeenCalled();
    expect(runMomentsMaintenance).not.toHaveBeenCalled();
  });

  it('runs the event and moments jobs side by side for the five-minute trigger, and no timetable job', async () => {
    const { ctx, pending, waitUntil } = context();
    await worker.scheduled(controller(EVENTS_CRON, scheduledTime), env, ctx);
    await Promise.all(pending);
    expect(waitUntil).toHaveBeenCalledTimes(2);
    expect(runScheduledNotifications).toHaveBeenCalledWith(env, new Date(scheduledTime));
    expect(runMomentsMaintenance).toHaveBeenCalledWith(env, new Date(scheduledTime));
    expect(runTimetableReminders).not.toHaveBeenCalled();
    expect(runStickerMaintenance).not.toHaveBeenCalled();
  });

  it('runs the sticker sweep alone for the hourly trigger', async () => {
    const { ctx, pending, waitUntil } = context();
    await worker.scheduled(controller(STICKERS_CRON, scheduledTime), env, ctx);
    await Promise.all(pending);
    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(runStickerMaintenance).toHaveBeenCalledWith(env, new Date(scheduledTime));
    expect(runScheduledNotifications).not.toHaveBeenCalled();
    expect(runMomentsMaintenance).not.toHaveBeenCalled();
    expect(runTimetableReminders).not.toHaveBeenCalled();
  });
});
