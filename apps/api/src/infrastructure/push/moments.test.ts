import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../env';
import { forgetFcmAccessToken } from './fcm';
import { commentPushKinds, notifyMomentEvent } from './moments';

const BASE = 'https://utmmsc.com/UTMMSC/';

interface Member {
  /** Stored 好友动态互动 switch; undefined means no row, so on. */
  /** 已存的「好友动态互动」开关；undefined 表示没有记录，即开启。 */
  moments?: boolean;
  preview?: boolean;
}

interface SentPush {
  token: string;
  title: string;
  body: string;
  android: { priority: string; collapse_key?: string; notification: { channel_id: string; tag: string } };
  data: Record<string, string>;
}

/**
 * D1 for the two reads a moments push makes: the 好友动态互动 opt-outs and the live devices, one FCM token per
 * member named tok-<id>. Before migration 0016 the opt-out read fails like D1 does for the missing column.
 * 模拟好友动态推送所做的两次读取：关闭了「好友动态互动」的成员，以及有效设备（每位成员一个名为 tok-<id> 的 FCM 令牌）。
 * 迁移 0016 之前，读取开关会像 D1 遇到缺失的列那样失败。
 */
function fakeDb(members: Record<string, Member>, options: { before0016?: boolean; broken?: boolean } = {}) {
  const asked: { table: 'prefs' | 'devices'; ids: string[] }[] = [];
  const db = {
    prepare(sql: string) {
      const statement = {
        params: [] as unknown[],
        bind(...params: unknown[]) {
          statement.params = params;
          return statement;
        },
        async all() {
          if (options.broken) throw new Error('D1_ERROR: network connection lost');
          if (sql.includes('FROM notification_prefs WHERE moments = 0')) {
            if (options.before0016) throw new Error('D1_ERROR: no such column: moments: SQLITE_ERROR');
            const ids = statement.params as string[];
            asked.push({ table: 'prefs', ids });
            return { results: ids.filter((id) => members[id]?.moments === false).map((id) => ({ member_id: id })) };
          }
          if (sql.includes('FROM push_devices d')) {
            const ids = statement.params.slice(1) as string[];
            asked.push({ table: 'devices', ids });
            const results = ids
              .filter((id) => members[id])
              .map((id) => ({
                id: `dev-${id}`,
                member_id: id,
                kind: 'fcm',
                endpoint: `tok-${id}`,
                keys_json: null,
                failure_count: 0,
                session_id: `ses-${id}`,
                pref_messages: 1,
                pref_events: 1,
                pref_preview: members[id]?.preview === false ? 0 : 1,
              }));
            return { results };
          }
          throw new Error(`unexpected query: ${sql}`);
        },
      };
      return statement;
    },
    async batch(list: unknown[]) {
      return list.map(() => ({ meta: { changes: 1 } }));
    },
  };
  return { db: db as unknown as D1Database, asked };
}

let serviceAccount = '';
let sent: SentPush[] = [];

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const der = new Uint8Array((await crypto.subtle.exportKey('pkcs8', pair.privateKey)) as ArrayBuffer);
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----\n`;
  serviceAccount = JSON.stringify({ project_id: 'p', client_email: 'push@p.iam.gserviceaccount.com', private_key: pem });
});

beforeEach(() => {
  sent = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (url.startsWith('https://oauth2.googleapis.com/')) return Response.json({ access_token: 'access', expires_in: 3600 });
    const { message } = JSON.parse(String(init?.body)) as { message: { token: string; notification: { title: string; body: string }; android: SentPush['android']; data: Record<string, string> } };
    sent.push({ token: message.token, title: message.notification.title, body: message.notification.body, android: message.android, data: message.data });
    return Response.json({ name: 'projects/p/messages/1' });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  forgetFcmAccessToken();
});

function envWith(db: D1Database): Env {
  return { DB: db, FCM_SERVICE_ACCOUNT: serviceAccount, APP_BASE_URL: BASE } as unknown as Env;
}

function byToken(token: string): SentPush | undefined {
  return sent.find((push) => push.token === token);
}

const comment = {
  type: 'comment' as const,
  postId: 'pst_1',
  commentId: 'cmt_9',
  actorName: '张三',
  text: '好看！',
};

describe('commentPushKinds', () => {
  it('pushes comment and reply notices, never thread, and lets reply win for a member named twice', () => {
    const kinds = commentPushKinds([
      { recipientId: 'author', kind: 'comment' },
      { recipientId: 'answered', kind: 'reply' },
      { recipientId: 'liker', kind: 'thread' },
      { recipientId: 'both', kind: 'reply' },
      { recipientId: 'both', kind: 'comment' },
    ]);
    expect([...kinds]).toEqual([
      ['author', 'comment'],
      ['answered', 'reply'],
      ['both', 'reply'],
    ]);
  });
});

describe('notifyMomentEvent', () => {
  it('tells the post author and the member answered, on the moments channel, and leaves thread notices in the app', async () => {
    const { db, asked } = fakeDb({ author: {}, answered: {}, liker: {} });
    await notifyMomentEvent(envWith(db), {
      ...comment,
      notices: [
        { recipientId: 'author', kind: 'comment' },
        { recipientId: 'answered', kind: 'reply' },
        { recipientId: 'liker', kind: 'thread' },
      ],
    });
    expect(sent).toHaveLength(2);
    expect(byToken('tok-author')).toMatchObject({
      title: '好友动态',
      body: '张三评论了你：好看！',
      android: { priority: 'NORMAL', collapse_key: 'moment:pst_1', notification: { channel_id: 'moments', tag: 'moment:pst_1' } },
      data: { kind: 'moment', postId: 'pst_1', url: 'https://utmmsc.com/UTMMSC/discover/feed/post/pst_1?comment=cmt_9' },
    });
    expect(byToken('tok-answered')?.body).toBe('张三回复了你：好看！');
    expect(asked.map((query) => query.ids)).toEqual([
      ['author', 'answered'],
      ['author', 'answered'],
    ]);
  });

  it('sends nothing to members who turned 好友动态互动 off, and does not look up their devices', async () => {
    const { db, asked } = fakeDb({ author: { moments: false }, answered: {} });
    await notifyMomentEvent(envWith(db), {
      ...comment,
      notices: [
        { recipientId: 'author', kind: 'comment' },
        { recipientId: 'answered', kind: 'reply' },
      ],
    });
    expect(sent.map((push) => push.token)).toEqual(['tok-answered']);
    expect(asked.find((query) => query.table === 'devices')?.ids).toEqual(['answered']);
  });

  it('hides the name and the text from a member who hides previews', async () => {
    const { db } = fakeDb({ author: { preview: false } });
    await notifyMomentEvent(envWith(db), { ...comment, notices: [{ recipientId: 'author', kind: 'comment' }] });
    expect(sent).toEqual([expect.objectContaining({ title: 'UTMMSC', body: '好友动态有新互动', data: expect.objectContaining({ tag: 'moment:pst_1' }) })]);
  });

  it('asks nothing when a comment only made thread notices', async () => {
    const { db, asked } = fakeDb({ liker: {} });
    await notifyMomentEvent(envWith(db), { ...comment, notices: [{ recipientId: 'liker', kind: 'thread' }] });
    expect(asked).toEqual([]);
    expect(sent).toEqual([]);
  });

  it('treats everyone as on before migration 0016, so the pushes still go', async () => {
    const { db } = fakeDb({ author: { moments: false } }, { before0016: true });
    await notifyMomentEvent(envWith(db), { ...comment, notices: [{ recipientId: 'author', kind: 'comment' }] });
    expect(sent.map((push) => push.token)).toEqual(['tok-author']);
  });

  it('tells the author a moderator removed their post or comment, under a tag of its own', async () => {
    const { db } = fakeDb({ author: {} });
    await notifyMomentEvent(envWith(db), { type: 'removed', postId: 'pst_1', target: 'post', memberId: 'author' });
    await notifyMomentEvent(envWith(db), { type: 'removed', postId: 'pst_2', target: 'comment', memberId: 'author' });
    expect(sent.map((push) => [push.body, push.data.tag, push.data.url])).toEqual([
      ['你的一条动态已被管理员移除', 'moment:pst_1:removed', 'https://utmmsc.com/UTMMSC/discover/feed/notices'],
      ['你的一条评论已被管理员移除', 'moment:pst_2:removed', 'https://utmmsc.com/UTMMSC/discover/feed/notices'],
    ]);
    expect(sent[0]?.android.notification.channel_id).toBe('moments');
  });

  it('respects the switch for a removal too', async () => {
    const { db, asked } = fakeDb({ author: { moments: false } });
    await notifyMomentEvent(envWith(db), { type: 'removed', postId: 'pst_1', target: 'post', memberId: 'author' });
    expect(sent).toEqual([]);
    expect(asked.map((query) => query.table)).toEqual(['prefs']);
  });

  it('replaces a deleted comment’s notice only for members who saw its text', async () => {
    const { db } = fakeDb({ shown: {}, hidden: { preview: false }, off: { moments: false } });
    await notifyMomentEvent(envWith(db), { type: 'recall', postId: 'pst_1', memberIds: ['shown', 'hidden', 'off', 'shown'] });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      token: 'tok-shown',
      title: '好友动态',
      body: '一条评论已删除',
      data: { kind: 'moment_recall', tag: 'moment:pst_1', postId: 'pst_1', url: 'https://utmmsc.com/UTMMSC/discover/feed/post/pst_1' },
    });
  });

  it('asks nothing for a recall with no recipients', async () => {
    const { db, asked } = fakeDb({});
    await notifyMomentEvent(envWith(db), { type: 'recall', postId: 'pst_1', memberIds: [] });
    expect(asked).toEqual([]);
  });

  it('logs a failure and never throws', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { db } = fakeDb({ author: {} }, { broken: true });
    await expect(notifyMomentEvent(envWith(db), { ...comment, notices: [{ recipientId: 'author', kind: 'comment' }] })).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith('push: moments comment notification failed', 'D1_ERROR: network connection lost');
    expect(sent).toEqual([]);
  });
});
