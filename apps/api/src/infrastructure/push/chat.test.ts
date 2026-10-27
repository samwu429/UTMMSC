import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_NOTIFICATION_PREFS, type NotificationPrefs, type PushPayload } from '@utmmsc/shared';
import { readProfileMediaToken } from '../../domain/profile/media-token';
import type { Env } from '../../env';
import type { PushableMember } from '../d1/push-devices';
import { createSqliteD1, sqlite, type SqliteD1 } from '../d1/testing/sqlite-d1';

const pushable = vi.hoisted(() => ({ members: [] as PushableMember[] }));
const sent = vi.hoisted(() => ({ payloads: new Map<string, unknown>() }));

vi.mock('../d1/push-devices', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../d1/push-devices')>()),
  listPushableMembers: async (_db: D1Database, ids?: readonly string[]) => pushable.members.filter((m) => !ids || ids.includes(m.id)),
}));
vi.mock('./send', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./send')>()),
  sendToMembers: async (_env: Env, memberIds: readonly string[], payloadFor: (id: string, prefs: NotificationPrefs) => unknown) => {
    for (const id of memberIds) sent.payloads.set(id, payloadFor(id, pushable.members.find((m) => m.id === id)?.prefs ?? { ...DEFAULT_NOTIFICATION_PREFS }));
    return { devices: memberIds.length, sent: memberIds.length, failed: 0, recipients: memberIds.length };
  },
}));

const { channelPushIcon, notifyChatMessage, notifyChatRetraction } = await import('./chat');

const SECRET = 'test-secret';
const UPLOAD = 'channel-icon/ch_all/cic_abcdefghijklmnop.webp';

function member(id: string, prefs: Partial<NotificationPrefs> = {}): PushableMember {
  return { id, role: 'student', acting_role: null, enrollment_status: 'student', prefs: { ...DEFAULT_NOTIFICATION_PREFS, ...prefs } };
}

describe.skipIf(!sqlite)('chat pushes with channel icons', () => {
  let d1: SqliteD1;
  let env: Env;

  beforeEach(() => {
    d1 = createSqliteD1();
    env = { DB: d1.db, SESSION_SECRET: SECRET, APP_BASE_URL: 'https://utmmsc.com/UTMMSC/', API_PUBLIC_URL: 'https://utmmsc.com/api' } as unknown as Env;
    pushable.members = [member('mem_ann'), member('mem_bob'), member('mem_cy', { preview: false })];
    sent.payloads.clear();
  });
  afterEach(() => d1.close());

  const message = (roomId = 'channel:ch_all') => ({
    roomId,
    authorId: 'mem_ann',
    authorName: 'Ann',
    text: 'hello',
    hasImage: false,
    mentions: [],
    mentionAll: false,
    connectedMemberIds: [],
  });

  const payloadOf = (id: string) => sent.payloads.get(id) as PushPayload | undefined;

  it('gives every recipient the uploaded icon under the public API address, with one token that opens it', async () => {
    d1.rows("UPDATE channels SET icon_key = ? WHERE id = 'ch_all'", UPLOAD);
    await notifyChatMessage(env, message());
    const icon = payloadOf('mem_bob')?.icon;
    expect(icon).toMatch(/^https:\/\/utmmsc\.com\/api\/members\/media\/channel-icon%2Fch_all%2Fcic_abcdefghijklmnop\.webp\?t=/);
    const token = decodeURIComponent(new URL(icon ?? '').searchParams.get('t') ?? '');
    expect(await readProfileMediaToken(SECRET, token)).toBe(true);
    expect(payloadOf('mem_ann')).toBeUndefined();
    expect(payloadOf('mem_cy')?.icon).toBeUndefined();
  });

  it('gives a preset as the PNG published with the app', async () => {
    d1.rows("UPDATE channels SET icon_key = 'preset:events' WHERE id = 'ch_all'");
    await notifyChatMessage(env, message());
    expect(payloadOf('mem_bob')?.icon).toBe('https://utmmsc.com/UTMMSC/channel-icons/events-192.png');
  });

  it('leaves the icon out without one, and an upload out without API_PUBLIC_URL', async () => {
    await notifyChatMessage(env, message());
    expect(payloadOf('mem_bob')?.icon).toBeUndefined();
    d1.rows("UPDATE channels SET icon_key = ? WHERE id = 'ch_all'", UPLOAD);
    sent.payloads.clear();
    await notifyChatMessage({ ...env, API_PUBLIC_URL: undefined }, message());
    expect(payloadOf('mem_bob')?.title).toBeDefined();
    expect(payloadOf('mem_bob')?.icon).toBeUndefined();
  });

  it('keeps the icon on the notice that replaces a withdrawn message', async () => {
    d1.rows("UPDATE channels SET icon_key = 'preset:announce' WHERE id = 'ch_all'");
    await notifyChatRetraction(env, { roomId: 'channel:ch_all', authorName: 'Ann', reason: 'recalled', memberIds: ['mem_bob', 'mem_cy'] });
    expect(payloadOf('mem_bob')).toMatchObject({ kind: 'recall', icon: 'https://utmmsc.com/UTMMSC/channel-icons/announce-192.png' });
    expect(payloadOf('mem_cy')).toBeNull();
  });

  it('forwards a sticker, so the push reads [表情]', async () => {
    await notifyChatMessage(env, { ...message(), text: '', hasSticker: true });
    expect(payloadOf('mem_bob')?.body).toBe('Ann: [表情]');
    expect(payloadOf('mem_cy')?.body).toBe('你收到一条新消息');
  });

  it('never fails the fan-out over the icon', async () => {
    expect(await channelPushIcon({ ...env, SESSION_SECRET: undefined } as unknown as Env, UPLOAD)).toBeUndefined();
    expect(await channelPushIcon(env, null)).toBeUndefined();
  });
});
