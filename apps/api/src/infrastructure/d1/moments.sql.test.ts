import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  canDeleteMomentComment,
  canModerateMoment,
  canSeeMomentInteraction,
  canSeeMomentPost,
  MOMENT_AUDIENCES,
  MOMENT_INLINE_COMMENTS,
  MOMENT_INLINE_LIKES,
  showsOnHomeFeed,
  type MomentAudience,
  type MomentPost,
  type MomentPostFacts,
  type MomentViewer,
  type Role,
} from '@utmmsc/shared';
import { decodeMomentCursor, type MomentCursor } from '../../domain/moments/cursor';
import type { CreateMomentInput } from '../../domain/moments/input';
import { planCommentNotices, planLikeNotice } from '../../domain/moments/notices';
import { momentObjectKey } from '../../domain/profile/media';
import {
  countCommentsSince,
  deleteMomentComment,
  findMomentComment,
  insertMomentComment,
  listMomentComments,
  setMomentLike,
  type InsertMomentCommentResult,
} from './moment-interactions';
import {
  clearMomentNotices,
  latestCommentNoticeRecipients,
  listMomentNotices,
  loadCommentNoticeFacts,
  markMomentFeedSeen,
  markMomentNoticesRead,
  readMomentBadge,
} from './moment-notices';
import {
  countReportsSince,
  dismissMomentReports,
  findMomentRelation,
  findMomentReport,
  insertMomentReport,
  listMomentBlocks,
  listMomentReports,
  removeMomentComment,
  removeMomentPost,
  restoreMomentComment,
  restoreMomentPost,
  updateMomentRelation,
} from './moment-safety';
import {
  countMomentAudience,
  countMomentsSince,
  deleteMoment,
  findAlbumOwner,
  findMomentAccess,
  findMomentByClientId,
  findMomentPost,
  insertMoment,
  listAlbum,
  listHomeFeed,
  recordMomentUpload,
  type InsertMomentResult,
  type MomentPage,
  type MomentReader,
} from './moments';
import { sweepMomentUploads } from './moment-maintenance';
import { deletePost, insertPost, listFeed, listMemberPosts } from './profile';
import { createSqliteD1, sqlite, type SqliteD1 } from './testing/sqlite-d1';

/** Seeded rows sit in 2020, so rows the code writes with nowIso are always newer. */
/** 测试数据写在 2020 年，因此代码用 nowIso 写入的记录总是更新。 */
const T0 = Date.parse('2020-01-01T00:00:00.000Z');
const at = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString();
const DAY_AGO = () => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

function reader(id: string, role: Role = 'student'): MomentReader {
  return { id, role };
}

/** Plain inserts for test rows, in the columns the migrations define. */
/** 按迁移定义的列直接写入测试数据。 */
function seeder(d1: SqliteD1) {
  const run = (sql: string, ...params: unknown[]) => {
    d1.rows(sql, ...params);
  };
  return {
    member(id: string, patch: { status?: string; role?: Role; name?: string } = {}) {
      run(
        `INSERT INTO members (id, email, display_name, password_hash, status, role, enrollment_status, graduation_year, created_at, updated_at, avatar_key, cover_key, headline)
         VALUES (?, ?, ?, 'hash', ?, ?, 'student', 2027, ?, ?, ?, ?, ?)`,
        id,
        `${id}@mail.utoronto.ca`,
        patch.name ?? id,
        patch.status ?? 'active',
        patch.role ?? 'student',
        at(0),
        at(0),
        `avatar/${id}/a.jpg`,
        `cover/${id}/c.jpg`,
        `${id} headline`,
      );
    },
    friends(a: string, b: string, status: 'accepted' | 'pending' | 'rejected' = 'accepted') {
      run('INSERT INTO friend_requests (id, from_id, to_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', `frq_${a}_${b}`, a, b, status, at(0), at(0));
    },
    block(memberId: string, targetId: string, kind: 'hide_from' | 'mute') {
      run('INSERT INTO moment_blocks (member_id, target_id, kind, created_at) VALUES (?, ?, ?, ?)', memberId, targetId, kind, at(0));
    },
    post(id: string, author: string, patch: { audience?: MomentAudience; at?: string; removed?: boolean; body?: string } = {}) {
      run(
        'INSERT INTO posts (id, member_id, body, created_at, audience, removed_at, removed_reason) VALUES (?, ?, ?, ?, ?, ?, ?)',
        id,
        author,
        patch.body ?? `${id} body`,
        patch.at ?? at(10),
        patch.audience ?? 'friends',
        patch.removed ? at(11) : null,
        patch.removed ? 'spam' : null,
      );
    },
    media(postId: string, key: string, patch: { kind?: 'image' | 'video'; previewKey?: string | null; sort?: number } = {}) {
      run(
        `INSERT INTO post_media (id, post_id, object_key, content_type, kind, sort_order, created_at, width, height, duration_ms, preview_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, 100, 80, NULL, ?)`,
        `pmd_${key.replace(/\W/g, '')}`,
        postId,
        key,
        patch.kind === 'video' ? 'video/mp4' : 'image/jpeg',
        patch.kind ?? 'image',
        patch.sort ?? 0,
        at(10),
        patch.previewKey ?? null,
      );
    },
    like(postId: string, memberId: string, when: string = at(20)) {
      run('INSERT INTO post_likes (post_id, member_id, created_at) VALUES (?, ?, ?)', postId, memberId, when);
    },
    comment(id: string, postId: string, author: string, patch: { at?: string; replyToComment?: string | null; replyToMember?: string | null; removed?: boolean; body?: string } = {}) {
      run(
        `INSERT INTO post_comments (id, post_id, author_id, reply_to_comment_id, reply_to_member_id, body, client_id, created_at, removed_at, removed_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        postId,
        author,
        patch.replyToComment ?? null,
        patch.replyToMember ?? null,
        patch.body ?? `${id} text`,
        `cid_${id.replace(/\W/g, '')}_00`,
        patch.at ?? at(30),
        patch.removed ? at(31) : null,
        patch.removed ? 'rude' : null,
      );
    },
  };
}

async function collect(load: (cursor: MomentCursor | null) => Promise<MomentPage>): Promise<MomentPost[]> {
  const posts: MomentPost[] = [];
  let cursor: MomentCursor | null = null;
  for (let page = 0; page < 200; page++) {
    const result = await load(cursor);
    posts.push(...result.posts);
    if (!result.nextCursor) return posts;
    cursor = result.nextCursor;
  }
  throw new Error('paging never ended');
}

/**
 * A comment the way the comment route makes one: the answered row decides the member answered, an answer to
 * oneself is stored as a plain comment, and the notices come from loadCommentNoticeFacts and planCommentNotices.
 * 按评论接口的方式发表评论：被回复者取自被回复的那一行，回复自己按普通评论保存，消息来自 loadCommentNoticeFacts 与 planCommentNotices。
 */
async function postComment(db: D1Database, actor: MomentReader, postId: string, text: string, options: { replyTo?: string; clientId?: string } = {}): Promise<InsertMomentCommentResult> {
  const access = await findMomentAccess(db, actor.id, postId);
  if (!access) throw new Error('no such post');
  let replyTo: { commentId: string; memberId: string } | null = null;
  if (options.replyTo) {
    const record = await findMomentComment(db, options.replyTo);
    if (record && record.facts.authorId !== actor.id) replyTo = { commentId: record.id, memberId: record.facts.authorId };
  }
  const facts = await loadCommentNoticeFacts(db, { postId, postAuthorId: access.facts.authorId, actorId: actor.id, replyToMemberId: replyTo?.memberId ?? null });
  const notices = planCommentNotices({
    postAuthorId: access.facts.authorId,
    audience: access.facts.audience,
    actorId: actor.id,
    replyToMemberId: replyTo?.memberId ?? null,
    replyTarget: facts.replyTarget,
    participants: facts.participants,
  });
  return insertMomentComment(db, actor, access, { clientId: options.clientId ?? `cid_${Math.random().toString(36).slice(2, 12)}`, body: text, replyTo, notices });
}

async function like(db: D1Database, actor: MomentReader, postId: string, liked: boolean) {
  const access = await findMomentAccess(db, actor.id, postId);
  if (!access) throw new Error('no such post');
  return setMomentLike(db, actor, access, liked, liked ? planLikeNotice(access.facts.authorId, actor.id) : null);
}

function createdComment(result: InsertMomentCommentResult) {
  if (result.status !== 'created' && result.status !== 'existing') throw new Error(`comment not stored: ${result.status}`);
  return result;
}

function storedMoment(result: InsertMomentResult) {
  if (result.status === 'media_gone') throw new Error('moment not stored: media_gone');
  return result;
}

/** A bucket that records each delete call. */
/** 记录每次删除调用的存储桶。 */
function recordingBucket() {
  const deletes: string[][] = [];
  const bucket = {
    delete: async (keys: string | string[]) => {
      deletes.push(Array.isArray(keys) ? [...keys] : [keys]);
    },
  } as unknown as R2Bucket;
  return { bucket, deletes };
}

/** A clock two days ahead, so every upload recorded with nowIso is past the sweep's day. */
/** 拨快两天的时钟，用 nowIso 记录的每次上传因此都超过了清理任务的一天期限。 */
const SWEEP_LATER = () => new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);

describe.skipIf(!sqlite)('moments on real SQLite', () => {
  let d1: SqliteD1;
  let db: D1Database;
  let seed: ReturnType<typeof seeder>;

  beforeEach(() => {
    d1 = createSqliteD1();
    db = d1.db;
    seed = seeder(d1);
  });

  afterEach(() => {
    d1.close();
  });

  /**
   * alice is friends with bob, carol and erin; bob and carol are friends; dave knows nobody. erin is the
   * president, vic a vice president, hank a department head, sam the system admin; gone is disabled.
   * alice 与 bob、carol、erin 是好友；bob 与 carol 是好友；dave 谁也不认识。erin 是主席，vic 是副主席，hank 是部长，
   * sam 是系统管理员；gone 已停用。
   */
  function people() {
    seed.member('alice', { name: 'Alice' });
    seed.member('bob', { name: 'Bob' });
    seed.member('carol', { name: 'Carol' });
    seed.member('dave', { name: 'Dave' });
    seed.member('erin', { name: 'Erin', role: 'president' });
    seed.member('vic', { name: 'Vic', role: 'vp_finance' });
    seed.member('hank', { name: 'Hank', role: 'head_events' });
    seed.member('sam', { name: 'Sam', role: 'superadmin' });
    seed.member('gone', { name: 'Gone', status: 'disabled' });
    seed.friends('alice', 'bob');
    seed.friends('carol', 'alice');
    seed.friends('bob', 'carol');
    seed.friends('alice', 'erin');
    seed.friends('alice', 'gone');
    seed.friends('dave', 'alice', 'pending');
  }

  describe('migrations', () => {
    it('apply 0001 through 0016, and a post written before 0016 reads club', async () => {
      const fresh = createSqliteD1({ migrate: false });
      try {
        fresh.migrate({ to: 15 });
        const early = seeder(fresh);
        early.member('a');
        early.member('b');
        fresh.rows("INSERT INTO posts (id, member_id, body, created_at) VALUES ('post_old', 'a', 'old', ?)", at(5));
        fresh.rows(
          "INSERT INTO post_media (id, post_id, object_key, content_type, kind, sort_order, created_at) VALUES ('pmd_old', 'post_old', 'moments/a/med_x.jpg', 'image/jpeg', 'image', 0, ?)",
          at(5),
        );
        fresh.rows("INSERT INTO notification_prefs (member_id, messages, events, preview, updated_at) VALUES ('a', 0, 1, 1, ?)", at(5));
        fresh.migrate({ from: 16 });

        expect(fresh.rows('SELECT audience, location, client_id, removed_at FROM posts')).toEqual([{ audience: 'club', location: null, client_id: null, removed_at: null }]);
        expect(fresh.rows('SELECT messages, moments FROM notification_prefs')).toEqual([{ messages: 0, moments: 1 }]);
        const indexes = fresh.rows<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'posts'").map((row) => row.name);
        expect(indexes).toEqual(expect.arrayContaining(['posts_page', 'posts_member', 'posts_client']));
        expect(indexes).not.toContain('posts_created');

        const feed = await listHomeFeed(fresh.db, reader('b'), null);
        expect(feed.posts.map((post) => post.id)).toEqual(['post_old']);
        expect(feed.posts[0]?.clubWide).toBe(true);
        expect(feed.posts[0]?.media).toEqual([{ key: 'moments/a/med_x.jpg', contentType: 'image/jpeg', kind: 'image', width: null, height: null, previewKey: null, durationMs: null }]);
        expect((await listFeed(fresh.db, 'b', 40)).map((post) => post.id)).toEqual(['post_old']);
      } finally {
        fresh.close();
      }
    });

    it('enforce the audience, notice kinds, blocks on oneself and one report per item', () => {
      seed.member('a');
      seed.member('b');
      expect(() => seed.post('post_x', 'a', { audience: 'public' as MomentAudience })).toThrow(/CHECK constraint/);
      expect(() => seed.block('a', 'a', 'mute')).toThrow(/CHECK constraint/);
      seed.post('post_a', 'a');
      expect(() => d1.rows("INSERT INTO moment_notices (id, recipient_id, post_id, kind, created_at) VALUES ('n1', 'a', 'post_a', 'poke', ?)", at(1))).toThrow(/CHECK constraint/);
      const report = "INSERT INTO moment_reports (id, reporter_id, post_id, comment_id, target_member_id, reason, snapshot_json, created_at) VALUES (?, 'b', 'post_a', NULL, 'a', 'spam', '{}', ?)";
      d1.rows(report, 'r1', at(1));
      expect(() => d1.rows(report, 'r2', at(2))).toThrow(/UNIQUE constraint/);
    });
  });

  describe('the SQL agrees with the shared rules', () => {
    const ROLE_CHOICES: Role[] = ['student', 'student', 'alumni', 'head_events', 'president', 'vp_audit', 'superadmin'];

    /** Small and deterministic, so a failing seed can be replayed. */
    /** 小巧且可复现，失败的种子可以重放。 */
    function mulberry32(start: number): () => number {
      let state = start;
      return () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    interface WorldPost {
      id: string;
      author: string;
      audience: MomentAudience;
      removed: boolean;
      at: string;
    }
    interface WorldComment {
      id: string;
      postId: string;
      author: string;
      replyToMember: string | null;
      at: string;
      removed: boolean;
    }
    interface WorldLike {
      postId: string;
      memberId: string;
      at: string;
    }

    for (const seedValue of [1, 2, 3, 4, 5, 6]) {
      it(`matches canSeeMomentPost, showsOnHomeFeed and canSeeMomentInteraction for every viewer (seed ${seedValue})`, async () => {
        const rng = mulberry32(seedValue);
        const pick = <T>(items: readonly T[]): T => items[Math.floor(rng() * items.length)] as T;
        const token = () => Math.floor(rng() * 36 ** 6).toString(36).padStart(6, '0');

        const ids = Array.from({ length: 10 }, (_, index) => `m${index}`);
        const status = new Map(ids.map((id, index) => [id, index === 8 ? 'disabled' : index === 9 ? 'pending' : 'active']));
        const roles = new Map(ids.map((id) => [id, pick(ROLE_CHOICES)]));
        for (const id of ids) seed.member(id, { status: status.get(id), role: roles.get(id) });
        const active = (id: string) => status.get(id) === 'active';

        const friends = new Map(ids.map((id) => [id, new Set<string>()]));
        for (let i = 0; i < ids.length; i++) {
          for (let j = i + 1; j < ids.length; j++) {
            const r = rng();
            const [from, to] = rng() < 0.5 ? [ids[i]!, ids[j]!] : [ids[j]!, ids[i]!];
            if (r < 0.4) {
              seed.friends(from, to);
              friends.get(from)!.add(to);
              friends.get(to)!.add(from);
            } else if (r < 0.5) seed.friends(from, to, 'pending');
            else if (r < 0.55) seed.friends(from, to, 'rejected');
          }
        }
        const hides = new Set<string>();
        const mutes = new Set<string>();
        for (const owner of ids) {
          for (const target of ids) {
            if (owner === target) continue;
            if (rng() < 0.12) {
              seed.block(owner, target, 'hide_from');
              hides.add(`${owner}>${target}`);
            }
            if (rng() < 0.12) {
              seed.block(owner, target, 'mute');
              mutes.add(`${owner}>${target}`);
            }
          }
        }

        const posts: WorldPost[] = [];
        for (let index = 0; index < 36; index++) {
          const post: WorldPost = { id: `post_${token()}${index}`, author: pick(ids), audience: pick(MOMENT_AUDIENCES), removed: rng() < 0.15, at: at(Math.floor(rng() * 8) * 30) };
          seed.post(post.id, post.author, { audience: post.audience, removed: post.removed, at: post.at });
          posts.push(post);
        }
        const likes: WorldLike[] = [];
        const comments: WorldComment[] = [];
        for (const post of posts) {
          for (const memberId of ids) {
            if (rng() < 0.3) {
              const item = { postId: post.id, memberId, at: at(300 + Math.floor(rng() * 6)) };
              seed.like(item.postId, item.memberId, item.at);
              likes.push(item);
            }
          }
          const onPost: WorldComment[] = [];
          for (let n = Math.floor(rng() * 6); n > 0; n--) {
            const target = onPost.length > 0 && rng() < 0.45 ? pick(onPost) : null;
            const comment: WorldComment = {
              id: `pcm_${token()}`,
              postId: post.id,
              author: pick(ids),
              replyToMember: target?.author ?? null,
              at: at(400 + Math.floor(rng() * 6)),
              removed: rng() < 0.12,
            };
            const keepsTarget = target !== null && rng() < 0.8;
            seed.comment(comment.id, post.id, comment.author, {
              at: comment.at,
              replyToComment: keepsTarget ? target.id : null,
              replyToMember: comment.replyToMember,
              removed: comment.removed,
            });
            onPost.push(comment);
            comments.push(comment);
          }
        }

        const viewerOf = (id: string): MomentViewer => ({ id, friendIds: friends.get(id)! });
        const factsFor = (post: WorldPost, viewerId: string): MomentPostFacts => ({
          authorId: post.author,
          authorActive: active(post.author),
          audience: post.audience,
          removed: post.removed,
          hiddenFromViewer: hides.has(`${post.author}>${viewerId}`),
        });
        const newestFirst = (a: WorldPost, b: WorldPost) => (a.at !== b.at ? (a.at < b.at ? 1 : -1) : a.id < b.id ? 1 : -1);
        const byId = new Map(posts.map((post) => [post.id, post]));

        function expectHydrated(post: MomentPost, viewerId: string) {
          const source = byId.get(post.id)!;
          const viewer = viewerOf(viewerId);
          const me = reader(viewerId, roles.get(viewerId));
          const own = source.author === viewerId;
          const visibleLikes = likes
            .filter((item) => item.postId === post.id && active(item.memberId) && canSeeMomentInteraction(viewer, factsFor(source, viewerId), item.memberId, null))
            .sort((a, b) => (a.at !== b.at ? (a.at < b.at ? -1 : 1) : a.memberId < b.memberId ? -1 : 1));
          expect(post.likes.map((person) => person.id)).toEqual(visibleLikes.map((item) => item.memberId));
          expect(post.likeCount).toBe(visibleLikes.length);
          expect(post.likedByMe).toBe(visibleLikes.some((item) => item.memberId === viewerId));

          const visibleComments = comments
            .filter(
              (item) =>
                item.postId === post.id &&
                active(item.author) &&
                (!item.removed || item.author === viewerId) &&
                canSeeMomentInteraction(viewer, factsFor(source, viewerId), item.author, item.replyToMember && active(item.replyToMember) ? item.replyToMember : null),
            )
            .sort((a, b) => (a.at !== b.at ? (a.at < b.at ? -1 : 1) : a.id < b.id ? -1 : 1));
          expect(post.comments.map((item) => item.id)).toEqual(visibleComments.map((item) => item.id));
          expect(post.commentCount).toBe(visibleComments.length);
          expect(post.commentsCursor).toBeNull();
          for (const [index, comment] of post.comments.entries()) {
            const expected = visibleComments[index]!;
            expect(comment.replyTo?.id ?? null).toBe(expected.replyToMember && active(expected.replyToMember) ? expected.replyToMember : null);
            expect(comment.canDelete).toBe(canDeleteMomentComment(viewerId, { authorId: expected.author }, { authorId: source.author }));
            expect(comment.canModerate).toBe(canModerateMoment(me, { id: expected.author, role: roles.get(expected.author)! }));
            expect(comment.clientId !== undefined).toBe(expected.author === viewerId);
            expect(comment.removed !== undefined).toBe(expected.author === viewerId && expected.removed);
          }

          expect(post.clubWide).toBe(source.audience === 'club');
          expect(post.audience).toBe(own ? source.audience : undefined);
          expect(post.canDelete).toBe(own);
          expect(post.canReport).toBe(!own);
          expect(post.canInteract).toBe(!source.removed);
          expect(post.canModerate).toBe(canModerateMoment(me, { id: source.author, role: roles.get(source.author)! }));
          expect(post.removed !== undefined).toBe(own && source.removed);
        }

        for (const viewerId of ids.filter(active)) {
          const me = reader(viewerId, roles.get(viewerId));
          const viewer = viewerOf(viewerId);

          const home = posts.filter((post) => showsOnHomeFeed(viewer, factsFor(post, viewerId), mutes.has(`${viewerId}>${post.author}`))).sort(newestFirst);
          const feed = await collect((cursor) => listHomeFeed(db, me, cursor, 4));
          expect(feed.map((post) => post.id)).toEqual(home.map((post) => post.id));
          for (const post of feed) expectHydrated(post, viewerId);
          expect((await listFeed(db, viewerId, 100)).map((post) => post.id)).toEqual(home.map((post) => post.id));

          for (const authorId of ids) {
            const album = posts.filter((post) => post.author === authorId && canSeeMomentPost(viewer, factsFor(post, viewerId))).sort(newestFirst);
            const pages = await collect((cursor) => listAlbum(db, me, authorId, cursor, 3));
            expect(pages.map((post) => post.id)).toEqual(album.map((post) => post.id));
            expect((await listMemberPosts(db, viewerId, authorId, 100)).map((post) => post.id)).toEqual(album.map((post) => post.id));
          }

          for (const post of posts) {
            const visible = canSeeMomentPost(viewer, factsFor(post, viewerId));
            const found = await findMomentPost(db, me, post.id);
            expect(found !== null).toBe(visible);
            const access = await findMomentAccess(db, viewerId, post.id);
            expect(access && canSeeMomentPost(viewer, access.facts)).toBe(visible);
            expect(access?.friends).toBe(friends.get(viewerId)!.has(post.author));
            if (!found || !access) continue;
            expectHydrated(found, viewerId);
            const paged: string[] = [];
            let cursor: MomentCursor | null = null;
            do {
              const page = await listMomentComments(db, me, access, cursor, 2);
              paged.push(...page.comments.map((comment) => comment.id));
              cursor = page.nextCursor;
            } while (cursor);
            expect(paged).toEqual(found.comments.map((comment) => comment.id));
          }
        }
      });
    }
  });

  describe('query plans', () => {
    beforeEach(() => {
      people();
      for (let index = 0; index < 30; index++) {
        const id = `post_${String(index).padStart(2, '0')}`;
        seed.post(id, index % 2 ? 'alice' : 'bob', { audience: 'club', at: at(index) });
        seed.like(id, 'carol');
        seed.comment(`pcm_${index}`, id, 'carol');
      }
    });

    it('walks posts_page for the home feed without sorting, in four statements per page', async () => {
      d1.statements.length = 0;
      const page = await listHomeFeed(db, reader('carol'), { at: at(20), id: 'post_20' }, 10);
      expect(page.posts).toHaveLength(10);
      expect(d1.statements).toHaveLength(4);
      const plan = d1.explain(d1.statements[0]!).join('\n');
      expect(plan).toMatch(/posts_page/);
      expect(plan).not.toMatch(/TEMP B-TREE FOR ORDER BY/);
      expect(d1.explain(d1.statements[1]!).join('\n')).toMatch(/post_media_post/);
      expect(d1.explain(d1.statements[3]!).join('\n')).toMatch(/post_comments_post/);
    });

    it('walks posts_member for an album', async () => {
      d1.statements.length = 0;
      await listAlbum(db, reader('carol'), 'alice', null, 10);
      expect(d1.explain(d1.statements[0]!).join('\n')).toMatch(/posts_member/);
    });

    it('finds a comment’s notices and the replies to it by index, as deleting the comment needs', () => {
      // The lookups SQLite's ON DELETE CASCADE and ON DELETE SET NULL make for each deleted comment.
      // 每删除一条评论时，SQLite 的 ON DELETE CASCADE 和 ON DELETE SET NULL 所做的查找。
      const notices = d1.explain({ sql: 'DELETE FROM moment_notices WHERE comment_id = ?', params: ['pcm_1'] }).join('\n');
      expect(notices).toMatch(/moment_notices_comment_ref/);
      expect(notices).not.toMatch(/SCAN moment_notices/);
      const replies = d1.explain({ sql: 'UPDATE post_comments SET reply_to_comment_id = NULL WHERE reply_to_comment_id = ?', params: ['pcm_1'] }).join('\n');
      expect(replies).toMatch(/post_comments_reply/);
      expect(replies).not.toMatch(/SCAN post_comments/);
    });

    it('walks post_comments_post for a page of comments', async () => {
      const access = await findMomentAccess(db, 'carol', 'post_05');
      d1.statements.length = 0;
      await listMomentComments(db, reader('carol'), access!, { at: at(0), id: 'pcm_0' });
      expect(d1.explain(d1.statements[0]!).join('\n')).toMatch(/post_comments_post/);
    });
  });

  describe('posts', () => {
    beforeEach(people);

    function input(patch: Partial<CreateMomentInput> = {}): CreateMomentInput {
      return { clientId: 'cid_publish_01', text: '今天的活动', media: [], audience: 'friends', location: '多伦多', ...patch };
    }

    it('publishes with sizes and previews, consumes the uploads, and replays a clientId as the same post', async () => {
      const photo = momentObjectKey('alice', 'image/jpeg');
      const preview = momentObjectKey('alice', 'image/jpeg');
      const stray = momentObjectKey('alice', 'image/png');
      for (const key of [photo, preview, stray]) await recordMomentUpload(db, 'alice', key);
      await recordMomentUpload(db, 'alice', photo);
      const media = [{ key: photo, contentType: 'image/jpeg', kind: 'image' as const, width: 1200, height: 800, previewKey: preview, durationMs: null }];

      const first = storedMoment(await insertMoment(db, reader('alice'), input({ media })));
      expect(first.status).toBe('created');
      expect(first.post).toMatchObject({
        body: '今天的活动',
        location: '多伦多',
        audience: 'friends',
        clientId: 'cid_publish_01',
        clubWide: false,
        media,
        likes: [],
        comments: [],
        canDelete: true,
        canInteract: true,
        canReport: false,
      });
      expect(d1.rows('SELECT object_key FROM moment_uploads')).toEqual([{ object_key: stray }]);

      const again = storedMoment(await insertMoment(db, reader('alice'), input({ text: 'changed', media })));
      expect(again.status).toBe('existing');
      expect(again.post.id).toBe(first.post.id);
      expect(again.post.body).toBe('今天的活动');
      expect(d1.rows('SELECT COUNT(*) AS n FROM posts')).toEqual([{ n: 1 }]);
      expect((await findMomentByClientId(db, reader('alice'), 'cid_publish_01'))?.id).toBe(first.post.id);
      expect(await findMomentByClientId(db, reader('bob'), 'cid_publish_01')).toBeNull();

      const asFriend = await findMomentPost(db, reader('bob'), first.post.id);
      expect(asFriend?.audience).toBeUndefined();
      expect(asFriend?.clientId).toBeUndefined();
      expect(await findMomentPost(db, reader('dave'), first.post.id)).toBeNull();
    });

    it('answers a clientId race on the unique index with the first post', async () => {
      seed.post('post_first', 'alice', { audience: 'club' });
      d1.rows("UPDATE posts SET client_id = 'cid_race_0001' WHERE id = 'post_first'");
      let missed = false;
      const wrap = (statement: D1PreparedStatement, sql: string): D1PreparedStatement =>
        new Proxy(statement, {
          get(target, prop, receiver) {
            if (prop === 'bind') return (...values: unknown[]) => wrap(target.bind(...values), sql);
            if (prop === 'all' && !missed && sql.includes('p.client_id =')) {
              missed = true;
              return async () => ({ results: [], success: true, meta: {} });
            }
            return Reflect.get(target, prop, receiver);
          },
        });
      const racing = new Proxy(db, {
        get(target, prop, receiver) {
          if (prop === 'prepare') return (sql: string) => wrap(target.prepare(sql), sql);
          return Reflect.get(target, prop, receiver);
        },
      });
      const result = await insertMoment(racing, reader('alice'), input({ clientId: 'cid_race_0001' }));
      expect(missed).toBe(true);
      expect(result).toMatchObject({ status: 'existing', post: { id: 'post_first' } });
      expect(d1.rows('SELECT COUNT(*) AS n FROM posts')).toEqual([{ n: 1 }]);
    });

    it('deletes a post with its likes, comments and notices, returns every object and preview, and keeps reports and actions', async () => {
      seed.post('post_gone', 'alice', { audience: 'club' });
      seed.media('post_gone', 'moments/alice/med_a.jpg', { previewKey: 'moments/alice/med_ap.jpg' });
      seed.media('post_gone', 'moments/alice/med_b.jpg', { sort: 1 });
      await like(db, reader('bob'), 'post_gone', true);
      createdComment(await postComment(db, reader('carol'), 'post_gone', 'nice'));
      await insertMomentReport(db, { reporterId: 'dave', postId: 'post_gone', commentId: null, targetMemberId: 'alice', reason: 'spam', note: null });
      await removeMomentPost(db, 'erin', 'post_gone', '广告');
      expect(d1.rows('SELECT kind FROM moment_notices ORDER BY kind')).toEqual([{ kind: 'comment' }, { kind: 'like' }, { kind: 'removed' }, { kind: 'thread' }]);

      expect(await deleteMoment(db, 'bob', 'post_gone')).toBeNull();
      expect(await deleteMoment(db, 'alice', 'post_gone')).toEqual(['moments/alice/med_a.jpg', 'moments/alice/med_ap.jpg', 'moments/alice/med_b.jpg']);
      for (const table of ['posts', 'post_media', 'post_likes', 'post_comments', 'moment_notices']) {
        expect(d1.rows(`SELECT COUNT(*) AS n FROM ${table}`)).toEqual([{ n: 0 }]);
      }
      expect(d1.rows('SELECT COUNT(*) AS n FROM moment_reports')).toEqual([{ n: 1 }]);
      expect(d1.rows('SELECT action FROM moment_actions')).toEqual([{ action: 'remove_post' }]);
      expect(await deleteMoment(db, 'alice', 'post_gone')).toBeNull();
    });

    it('stores legacy posts as club, consumes their uploads, and deletes their previews', async () => {
      const key = momentObjectKey('alice', 'image/jpeg');
      await recordMomentUpload(db, 'alice', key);
      const post = await insertPost(db, 'alice', 'legacy', [{ key, contentType: 'image/jpeg', kind: 'image' }]);
      if (!post) throw new Error('legacy post not stored');
      expect(d1.rows('SELECT audience FROM posts WHERE id = ?', post.id)).toEqual([{ audience: 'club' }]);
      expect(d1.rows('SELECT COUNT(*) AS n FROM moment_uploads')).toEqual([{ n: 0 }]);
      expect((await listFeed(db, 'dave', 40)).map((item) => item.id)).toEqual([post.id]);
      d1.rows("UPDATE post_media SET preview_key = 'moments/alice/med_prev.jpg' WHERE post_id = ?", post.id);
      expect(await deletePost(db, 'bob', post.id)).toBeNull();
      expect(await deletePost(db, 'alice', post.id)).toEqual([key, 'moments/alice/med_prev.jpg']);
    });

    it('stores nothing, and keeps the uploads it had, when a file or preview is no longer recorded', async () => {
      const photo = momentObjectKey('alice', 'image/jpeg');
      const preview = momentObjectKey('alice', 'image/jpeg');
      const second = momentObjectKey('alice', 'image/jpeg');
      const bobs = momentObjectKey('alice', 'image/jpeg');
      await recordMomentUpload(db, 'alice', photo);
      await recordMomentUpload(db, 'alice', second);
      await recordMomentUpload(db, 'bob', bobs);
      const item = (key: string, previewKey: string | null) => ({ key, contentType: 'image/jpeg', kind: 'image' as const, width: 10, height: 10, previewKey, durationMs: null });
      const refused = { status: 'media_gone' };

      expect(await insertMoment(db, reader('alice'), input({ clientId: 'cid_gate_00001', media: [item(photo, preview)] }))).toEqual(refused);
      expect(await insertMoment(db, reader('alice'), input({ clientId: 'cid_gate_00002', media: [item(photo, null), item(momentObjectKey('alice', 'image/jpeg'), null)] }))).toEqual(refused);
      // Another member's upload row does not open the gate.
      // 其他成员的上传记录不能放行。
      expect(await insertMoment(db, reader('alice'), input({ clientId: 'cid_gate_00003', media: [item(photo, bobs)] }))).toEqual(refused);
      expect(await insertPost(db, 'alice', 'legacy', [{ key: momentObjectKey('alice', 'image/jpeg'), contentType: 'image/jpeg', kind: 'image' }])).toBeNull();
      for (const table of ['posts', 'post_media']) expect(d1.rows(`SELECT COUNT(*) AS n FROM ${table}`)).toEqual([{ n: 0 }]);
      expect(d1.rows('SELECT object_key FROM moment_uploads ORDER BY object_key')).toEqual([photo, second, bobs].sort().map((key) => ({ object_key: key })));

      // The refused clientId is free again, and the same files publish once every upload is recorded.
      // 被拒绝的 clientId 可以再次使用；全部上传都有记录后，同样的文件可以发表。
      await recordMomentUpload(db, 'alice', preview);
      const media = [item(photo, preview), item(second, null)];
      const stored = storedMoment(await insertMoment(db, reader('alice'), input({ clientId: 'cid_gate_00001', media })));
      expect(stored.status).toBe('created');
      expect(stored.post.media.map((entry) => [entry.key, entry.previewKey])).toEqual([
        [photo, preview],
        [second, null],
      ]);
      expect(d1.rows('SELECT member_id FROM moment_uploads')).toEqual([{ member_id: 'bob' }]);

      // A replay of the stored clientId still answers with the post, though its uploads were consumed.
      // 已保存的 clientId 再次发表时仍然返回这条动态，尽管其上传记录已被消耗。
      expect(await insertMoment(db, reader('alice'), input({ clientId: 'cid_gate_00001', media }))).toMatchObject({ status: 'existing', post: { id: stored.post.id } });
      expect(d1.rows('SELECT COUNT(*) AS n FROM posts')).toEqual([{ n: 1 }]);
    });

    it('cannot publish an upload the sweep claimed, and the sweep never deletes an object a post took', async () => {
      const claimed = momentObjectKey('alice', 'image/jpeg');
      const taken = momentObjectKey('alice', 'image/jpeg');
      await recordMomentUpload(db, 'alice', claimed);
      await recordMomentUpload(db, 'alice', taken);
      const item = (key: string) => ({ key, contentType: 'image/jpeg', kind: 'image' as const, width: 10, height: 10, previewKey: null, durationMs: null });
      storedMoment(await insertMoment(db, reader('alice'), input({ clientId: 'cid_sweep_0001', media: [item(taken)] })));

      const { bucket, deletes } = recordingBucket();
      expect(await sweepMomentUploads(db, bucket, SWEEP_LATER())).toEqual({ checked: 1, deleted: 1, kept: 0 });
      expect(deletes).toEqual([[claimed]]);
      expect(await insertMoment(db, reader('alice'), input({ clientId: 'cid_sweep_0002', media: [item(claimed)] }))).toEqual({ status: 'media_gone' });
      expect(d1.rows('SELECT object_key FROM post_media')).toEqual([{ object_key: taken }]);
    });

    it('counts posts for the daily cap', async () => {
      seed.post('post_old', 'alice');
      await insertMoment(db, reader('alice'), input({ clientId: 'cid_daily_0001' }));
      await insertMoment(db, reader('alice'), input({ clientId: 'cid_daily_0002' }));
      await insertMoment(db, reader('bob'), input({ clientId: 'cid_daily_0003' }));
      expect(await countMomentsSince(db, 'alice', DAY_AGO())).toBe(2);
      expect(await countMomentsSince(db, 'alice', at(0))).toBe(3);
    });

    it('describes access, the album owner and the audience sizes', async () => {
      seed.post('post_a', 'alice', { audience: 'friends' });
      seed.block('alice', 'bob', 'hide_from');
      const asBob = await findMomentAccess(db, 'bob', 'post_a');
      expect(asBob).toEqual({
        postId: 'post_a',
        facts: { authorId: 'alice', authorActive: true, audience: 'friends', removed: false, hiddenFromViewer: true },
        authorRole: 'student',
        friends: true,
        createdAt: at(10),
      });
      expect((await findMomentAccess(db, 'dave', 'post_a'))?.friends).toBe(false);
      expect(await findMomentAccess(db, 'dave', 'post_missing')).toBeNull();

      expect(await findAlbumOwner(db, reader('alice'), 'alice')).toEqual({
        owner: { id: 'alice', displayName: 'Alice', avatarKey: 'avatar/alice/a.jpg', coverKey: 'cover/alice/c.jpg', headline: 'alice headline' },
        clubOnly: false,
      });
      expect((await findAlbumOwner(db, reader('carol'), 'alice'))?.clubOnly).toBe(false);
      expect((await findAlbumOwner(db, reader('dave'), 'alice'))?.clubOnly).toBe(true);
      expect(await findAlbumOwner(db, reader('alice'), 'gone')).toBeNull();
      expect(await findAlbumOwner(db, reader('alice'), 'nobody')).toBeNull();

      expect(await countMomentAudience(db, 'alice')).toEqual({ friends: 3, club: 7 });
      expect(await countMomentAudience(db, 'dave')).toEqual({ friends: 0, club: 7 });
    });
  });

  describe('likes', () => {
    beforeEach(() => {
      people();
      seed.post('post_a', 'alice', { audience: 'friends' });
    });

    it('stores one like and one notice however often it is sent, and unliking removes both', async () => {
      const first = await like(db, reader('bob'), 'post_a', true);
      const second = await like(db, reader('bob'), 'post_a', true);
      expect(second).toEqual({ likedByMe: true, likes: [{ id: 'bob', displayName: 'Bob', avatarKey: 'avatar/bob/a.jpg' }], likeCount: 1 });
      expect(first).toEqual(second);
      expect(d1.rows('SELECT member_id FROM post_likes')).toEqual([{ member_id: 'bob' }]);
      expect(d1.rows('SELECT recipient_id, actor_id, kind FROM moment_notices')).toEqual([{ recipient_id: 'alice', actor_id: 'bob', kind: 'like' }]);

      expect(await like(db, reader('bob'), 'post_a', false)).toEqual({ likedByMe: false, likes: [], likeCount: 0 });
      expect(d1.rows('SELECT COUNT(*) AS n FROM post_likes')).toEqual([{ n: 0 }]);
      expect(d1.rows('SELECT COUNT(*) AS n FROM moment_notices')).toEqual([{ n: 0 }]);
      expect(await like(db, reader('bob'), 'post_a', false)).toEqual({ likedByMe: false, likes: [], likeCount: 0 });
    });

    it('writes no notice for the author’s own like, nor again after the notices were cleared', async () => {
      await like(db, reader('alice'), 'post_a', true);
      expect(d1.rows('SELECT COUNT(*) AS n FROM moment_notices')).toEqual([{ n: 0 }]);
      await like(db, reader('bob'), 'post_a', true);
      await clearMomentNotices(db, 'alice');
      await like(db, reader('bob'), 'post_a', true);
      expect(d1.rows('SELECT COUNT(*) AS n FROM moment_notices')).toEqual([{ n: 0 }]);
    });

    it('shows each viewer only the likes they may see', async () => {
      seed.like('post_a', 'carol', at(1));
      seed.like('post_a', 'erin', at(2));
      seed.like('post_a', 'gone', at(3));
      const asBob = await like(db, reader('bob'), 'post_a', true);
      expect(asBob?.likes.map((person) => person.id)).toEqual(['carol', 'bob']);
      expect(asBob?.likeCount).toBe(2);
      expect((await findMomentPost(db, reader('alice'), 'post_a'))?.likes.map((person) => person.id)).toEqual(['carol', 'erin', 'bob']);
    });

    it('caps the names at MOMENT_INLINE_LIKES and still counts every visible like', async () => {
      seed.post('post_club', 'alice', { audience: 'club' });
      for (let index = 0; index < MOMENT_INLINE_LIKES + 5; index++) {
        const id = `fan${String(index).padStart(3, '0')}`;
        seed.member(id);
        seed.like('post_club', id, at(index));
      }
      const result = await like(db, reader('dave'), 'post_club', true);
      expect(result?.likes).toHaveLength(MOMENT_INLINE_LIKES);
      expect(result?.likes[0]?.id).toBe('fan000');
      expect(result?.likeCount).toBe(MOMENT_INLINE_LIKES + 6);
      expect(result?.likedByMe).toBe(true);
      expect(result?.likes.some((person) => person.id === 'dave')).toBe(false);
    });

    it('answers null when the post was deleted after the check', async () => {
      const access = await findMomentAccess(db, 'bob', 'post_a');
      d1.rows("DELETE FROM posts WHERE id = 'post_a'");
      expect(await setMomentLike(db, reader('bob'), access!, true, { recipientId: 'alice', kind: 'like' })).toBeNull();
      expect(await setMomentLike(db, reader('bob'), access!, false, null)).toBeNull();
      expect(d1.rows('SELECT COUNT(*) AS n FROM post_likes')).toEqual([{ n: 0 }]);
    });
  });

  describe('comments', () => {
    beforeEach(() => {
      people();
      seed.post('post_a', 'alice', { audience: 'friends' });
    });

    it('stores a comment with its notices, replays its clientId, and refuses the clientId for other text or another post', async () => {
      seed.like('post_a', 'carol', at(1));
      const created = createdComment(await postComment(db, reader('bob'), 'post_a', '好看', { clientId: 'cid_comment_01' }));
      expect(created.status).toBe('created');
      expect(created.commentCount).toBe(1);
      expect(created.comment).toMatchObject({ postId: 'post_a', author: { id: 'bob' }, replyTo: null, body: '好看', canDelete: true, clientId: 'cid_comment_01' });
      expect(d1.rows('SELECT recipient_id, kind FROM moment_notices ORDER BY recipient_id')).toEqual([
        { recipient_id: 'alice', kind: 'comment' },
        { recipient_id: 'carol', kind: 'thread' },
      ]);

      const replay = createdComment(await postComment(db, reader('bob'), 'post_a', '好看', { clientId: 'cid_comment_01' }));
      expect(replay.status).toBe('existing');
      expect(replay.comment.id).toBe(created.comment.id);
      expect(d1.rows('SELECT COUNT(*) AS n FROM moment_notices')).toEqual([{ n: 2 }]);

      expect(await postComment(db, reader('bob'), 'post_a', '不一样', { clientId: 'cid_comment_01' })).toEqual({ status: 'conflict' });
      seed.post('post_b', 'alice', { audience: 'club' });
      expect(await postComment(db, reader('bob'), 'post_b', '好看', { clientId: 'cid_comment_01' })).toEqual({ status: 'conflict' });
      expect(d1.rows('SELECT COUNT(*) AS n FROM post_comments')).toEqual([{ n: 1 }]);
    });

    it('takes the member answered from the stored row and tells them, and the author, once each', async () => {
      const first = createdComment(await postComment(db, reader('carol'), 'post_a', 'first'));
      const reply = createdComment(await postComment(db, reader('bob'), 'post_a', 'answer', { replyTo: first.comment.id }));
      expect(reply.comment.replyTo).toEqual({ id: 'carol', displayName: 'Carol', avatarKey: 'avatar/carol/a.jpg' });
      expect(reply.comment.replyToCommentId).toBe(first.comment.id);
      expect(d1.rows('SELECT recipient_id, kind FROM moment_notices WHERE comment_id = ? ORDER BY recipient_id', reply.comment.id)).toEqual([
        { recipient_id: 'alice', kind: 'comment' },
        { recipient_id: 'carol', kind: 'reply' },
      ]);
      const record = await findMomentComment(db, reply.comment.id);
      expect(record).toMatchObject({
        facts: { postId: 'post_a', authorId: 'bob', authorActive: true, replyToId: 'carol', removed: false },
        authorRole: 'student',
        postAuthorId: 'alice',
        replyToMemberId: 'carol',
        body: 'answer',
      });
      expect(await findMomentComment(db, 'pcm_missing')).toBeNull();
    });

    it('stores a reply whose comment was deleted mid-write as if it came first, keeping the member answered', async () => {
      const first = createdComment(await postComment(db, reader('carol'), 'post_a', 'first'));
      const access = await findMomentAccess(db, 'bob', 'post_a');
      await deleteMomentComment(db, first.comment.id);
      const result = createdComment(
        await insertMomentComment(db, reader('bob'), access!, {
          clientId: 'cid_reply_gone1',
          body: 'late',
          replyTo: { commentId: first.comment.id, memberId: 'carol' },
          notices: [{ recipientId: 'carol', kind: 'reply' }],
        }),
      );
      expect(result.status).toBe('created');
      expect(result.comment.replyToCommentId).toBeNull();
      expect(result.comment.replyTo?.id).toBe('carol');
      expect(d1.rows('SELECT recipient_id, kind FROM moment_notices')).toEqual([{ recipient_id: 'carol', kind: 'reply' }]);
    });

    it('answers post_gone when the post was deleted after the check', async () => {
      const access = await findMomentAccess(db, 'bob', 'post_a');
      d1.rows("DELETE FROM posts WHERE id = 'post_a'");
      expect(await insertMomentComment(db, reader('bob'), access!, { clientId: 'cid_post_gone1', body: 'x', replyTo: null, notices: [{ recipientId: 'alice', kind: 'comment' }] })).toEqual({
        status: 'post_gone',
      });
      expect(d1.rows('SELECT COUNT(*) AS n FROM moment_notices')).toEqual([{ n: 0 }]);
    });

    it('carries 20 comments inline and pages the rest from commentsCursor', async () => {
      for (let index = 0; index < MOMENT_INLINE_COMMENTS + 5; index++) seed.comment(`pcm_${String(index).padStart(2, '0')}`, 'post_a', index % 2 ? 'bob' : 'carol', { at: at(100 + index) });
      const post = await findMomentPost(db, reader('alice'), 'post_a');
      expect(post?.comments).toHaveLength(MOMENT_INLINE_COMMENTS);
      expect(post?.commentCount).toBe(MOMENT_INLINE_COMMENTS + 5);
      const cursor = decodeMomentCursor(post?.commentsCursor);
      expect(cursor).toEqual({ at: at(100 + MOMENT_INLINE_COMMENTS - 1), id: `pcm_${MOMENT_INLINE_COMMENTS - 1}` });
      const access = await findMomentAccess(db, 'alice', 'post_a');
      const rest = await listMomentComments(db, reader('alice'), access!, cursor);
      expect(rest.comments.map((comment) => comment.id)).toEqual(['pcm_20', 'pcm_21', 'pcm_22', 'pcm_23', 'pcm_24']);
      expect(rest.nextCursor).toBeNull();
      expect((await findMomentPost(db, reader('alice'), 'post_a', 200))?.comments).toHaveLength(MOMENT_INLINE_COMMENTS + 5);
    });

    it('deletes a comment with its notices, after finding whose newest notice it was', async () => {
      const first = createdComment(await postComment(db, reader('bob'), 'post_a', 'one'));
      const second = createdComment(await postComment(db, reader('carol'), 'post_a', 'two'));
      expect(await latestCommentNoticeRecipients(db, 'post_a', first.comment.id)).toEqual([]);
      expect(await latestCommentNoticeRecipients(db, 'post_a', second.comment.id)).toEqual(['alice']);
      expect(await deleteMomentComment(db, second.comment.id)).toBe(true);
      expect(await deleteMomentComment(db, second.comment.id)).toBe(false);
      expect(d1.rows('SELECT COUNT(*) AS n FROM moment_notices WHERE comment_id = ?', second.comment.id)).toEqual([{ n: 0 }]);
      expect(await latestCommentNoticeRecipients(db, 'post_a', first.comment.id)).toEqual(['alice']);
    });

    it('counts comments for the daily cap', async () => {
      seed.comment('pcm_old', 'post_a', 'bob');
      await postComment(db, reader('bob'), 'post_a', 'a');
      await postComment(db, reader('bob'), 'post_a', 'b');
      expect(await countCommentsSince(db, 'bob', DAY_AGO())).toBe(2);
      expect(await countCommentsSince(db, 'bob', at(0))).toBe(3);
    });

    it('leaves the comment being sent out of the daily count, so its retry is not refused by itself', async () => {
      await postComment(db, reader('bob'), 'post_a', 'a', { clientId: 'retry_me_0001' });
      await postComment(db, reader('bob'), 'post_a', 'b');
      expect(await countCommentsSince(db, 'bob', DAY_AGO(), 'retry_me_0001')).toBe(1);
      expect(await countCommentsSince(db, 'bob', DAY_AGO(), 'never_sent_01')).toBe(2);
    });
  });

  describe('notice facts', () => {
    it('reads each participant’s friendships and hiding, leaving out the actor, the inactive and removed comments', async () => {
      people();
      seed.member('fay');
      seed.friends('fay', 'carol');
      seed.post('post_a', 'alice', { audience: 'club' });
      seed.like('post_a', 'bob', at(1));
      seed.comment('pcm_bob', 'post_a', 'bob', { at: at(5) });
      seed.comment('pcm_carol', 'post_a', 'carol', { at: at(3) });
      seed.like('post_a', 'dave', at(4));
      seed.like('post_a', 'gone', at(6));
      seed.comment('pcm_fay', 'post_a', 'fay', { at: at(7), removed: true });
      seed.like('post_a', 'hank', at(2));
      seed.block('alice', 'dave', 'hide_from');

      const facts = await loadCommentNoticeFacts(db, { postId: 'post_a', postAuthorId: 'alice', actorId: 'hank', replyToMemberId: 'carol' });
      expect(facts.replyTarget).toEqual({ memberId: 'carol', lastAt: at(3), friendOfActor: false, friendOfReplyTo: false, friendOfAuthor: true, hiddenFrom: false });
      expect(facts.participants).toEqual([
        { memberId: 'bob', lastAt: at(5), friendOfActor: false, friendOfReplyTo: true, friendOfAuthor: true, hiddenFrom: false },
        { memberId: 'dave', lastAt: at(4), friendOfActor: false, friendOfReplyTo: false, friendOfAuthor: false, hiddenFrom: true },
      ]);

      const plain = await loadCommentNoticeFacts(db, { postId: 'post_a', postAuthorId: 'alice', actorId: 'dave', replyToMemberId: null });
      expect(plain.replyTarget).toBeNull();
      expect(plain.participants.map((person) => person.memberId)).toEqual(['bob', 'carol', 'hank']);
      expect(plain.participants.every((person) => !person.friendOfReplyTo)).toBe(true);
    });
  });

  describe('notices', () => {
    beforeEach(() => {
      people();
      seed.post('post_a', 'alice', { audience: 'friends', body: '  第一行\n第二行  ' });
      seed.media('post_a', 'moments/alice/med_v.mp4', { kind: 'video', previewKey: 'moments/alice/med_vp.jpg' });
    });

    it('lists notices newest first with the post, the comment and who acted, and keeps the unread count', async () => {
      await like(db, reader('bob'), 'post_a', true);
      const comment = createdComment(await postComment(db, reader('carol'), 'post_a', 'hello'));
      d1.rows("UPDATE moment_notices SET created_at = CASE kind WHEN 'like' THEN ? ELSE ? END", at(1), at(2));
      const page = await listMomentNotices(db, reader('alice'), { cursor: null, unreadOnly: false });
      expect(page.unread).toBe(2);
      expect(page.nextCursor).toBeNull();
      expect(page.notices.map((notice) => notice.kind)).toEqual(['comment', 'like']);
      expect(page.notices[0]).toMatchObject({
        kind: 'comment',
        read: false,
        actor: { id: 'carol', displayName: 'Carol' },
        post: { id: 'post_a', excerpt: '第一行 第二行', preview: { key: 'moments/alice/med_vp.jpg', kind: 'video' }, available: true },
        comment: { id: comment.comment.id, body: 'hello', replyTo: null },
      });
      expect(page.notices[1]).toMatchObject({ kind: 'like', actor: { id: 'bob' }, comment: null });

      const first = await listMomentNotices(db, reader('alice'), { cursor: null, unreadOnly: false, limit: 1 });
      expect(first.notices.map((notice) => notice.kind)).toEqual(['comment']);
      const second = await listMomentNotices(db, reader('alice'), { cursor: first.nextCursor, unreadOnly: false, limit: 1 });
      expect(second.notices.map((notice) => notice.kind)).toEqual(['like']);
      expect(second.nextCursor).toBeNull();

      expect(await markMomentNoticesRead(db, 'alice', at(1))).toBe(1);
      expect((await listMomentNotices(db, reader('alice'), { cursor: null, unreadOnly: true })).notices.map((notice) => notice.kind)).toEqual(['comment']);
      expect(await markMomentNoticesRead(db, 'alice', at(2))).toBe(0);
      const read = await listMomentNotices(db, reader('alice'), { cursor: null, unreadOnly: false });
      expect(read.notices.every((notice) => notice.read)).toBe(true);
      expect((await listMomentNotices(db, reader('alice'), { cursor: null, unreadOnly: true })).notices).toEqual([]);

      await clearMomentNotices(db, 'alice');
      expect(await listMomentNotices(db, reader('alice'), { cursor: null, unreadOnly: false })).toEqual({ notices: [], nextCursor: null, unread: 0 });
    });

    it('sends only images as previews: a photo without one falls back to itself, a video without a frame has no key', async () => {
      seed.post('post_v', 'alice', { audience: 'club' });
      seed.media('post_v', 'moments/alice/med_old.mp4', { kind: 'video' });
      seed.post('post_p', 'alice', { audience: 'club' });
      seed.media('post_p', 'moments/alice/med_p.jpg');
      await like(db, reader('bob'), 'post_v', true);
      await like(db, reader('bob'), 'post_p', true);
      const { notices } = await listMomentNotices(db, reader('alice'), { cursor: null, unreadOnly: false });
      const previewOf = (postId: string) => notices.find((notice) => notice.post.id === postId)?.post.preview;
      expect(previewOf('post_v')).toEqual({ key: null, kind: 'video' });
      expect(previewOf('post_p')).toEqual({ key: 'moments/alice/med_p.jpg', kind: 'image' });
    });

    it('re-checks visibility, sending nothing of a post the reader can no longer see', async () => {
      const comment = createdComment(await postComment(db, reader('bob'), 'post_a', 'hi'));
      createdComment(await postComment(db, reader('carol'), 'post_a', 'answer', { replyTo: comment.comment.id }));
      seed.block('alice', 'bob', 'hide_from');
      const [notice] = (await listMomentNotices(db, reader('bob'), { cursor: null, unreadOnly: false })).notices;
      expect(notice).toMatchObject({ kind: 'reply', post: { id: 'post_a', excerpt: '', preview: null, available: false }, comment: { body: null, replyTo: null } });
    });

    it('blanks the text of a removed comment and drops notices from members no longer active', async () => {
      const comment = createdComment(await postComment(db, reader('bob'), 'post_a', 'hi'));
      d1.rows("UPDATE post_comments SET removed_at = ? WHERE id = ?", at(1), comment.comment.id);
      const [notice] = (await listMomentNotices(db, reader('alice'), { cursor: null, unreadOnly: false })).notices;
      expect(notice?.comment).toEqual({ id: comment.comment.id, body: null, replyTo: null });
      d1.rows("UPDATE members SET status = 'disabled' WHERE id = 'bob'");
      expect(await listMomentNotices(db, reader('alice'), { cursor: null, unreadOnly: false })).toEqual({ notices: [], nextCursor: null, unread: 0 });
    });

    it('badges unread notices with the latest actor, and new posts by others after the last visit', async () => {
      seed.post('post_old', 'bob', { audience: 'club', at: at(1) });
      seed.post('post_new', 'carol', { audience: 'club', at: at(50) });
      seed.post('post_newer', 'dave', { audience: 'club', at: at(60) });
      seed.post('post_mine', 'alice', { audience: 'club', at: at(70) });
      seed.post('post_hidden', 'bob', { audience: 'private', at: at(80) });

      expect(await readMomentBadge(db, reader('alice'))).toEqual({ unread: 0, latestActor: null, newPosts: 0, latestAuthor: null });
      await markMomentFeedSeen(db, 'alice', at(20));
      expect(await readMomentBadge(db, reader('alice'))).toMatchObject({ newPosts: 2, latestAuthor: { id: 'dave', displayName: 'Dave' } });
      seed.block('alice', 'dave', 'mute');
      expect(await readMomentBadge(db, reader('alice'))).toMatchObject({ newPosts: 1, latestAuthor: { id: 'carol' } });

      await markMomentFeedSeen(db, 'alice', at(55));
      await markMomentFeedSeen(db, 'alice', at(30));
      expect(d1.rows("SELECT feed_seen_at FROM moment_reads WHERE member_id = 'alice'")).toEqual([{ feed_seen_at: at(55) }]);
      expect((await readMomentBadge(db, reader('alice'))).newPosts).toBe(0);

      await like(db, reader('bob'), 'post_a', true);
      await postComment(db, reader('carol'), 'post_a', 'hey');
      expect(await readMomentBadge(db, reader('alice'))).toMatchObject({ unread: 2, latestActor: { id: 'carol', displayName: 'Carol' } });

      await markMomentFeedSeen(db, 'alice', '2999-01-01T00:00:00.000Z');
      const [seen] = d1.rows<{ feed_seen_at: string }>("SELECT feed_seen_at FROM moment_reads WHERE member_id = 'alice'");
      expect(seen!.feed_seen_at <= new Date().toISOString()).toBe(true);
    });
  });

  describe('blocks', () => {
    beforeEach(people);

    it('sets 不让TA看 and 不看TA field by field and lists active members only', async () => {
      expect(await findMomentRelation(db, 'alice', 'bob')).toEqual({ hideFrom: false, mute: false });
      expect(await updateMomentRelation(db, 'alice', 'bob', { hideFrom: true })).toEqual({ hideFrom: true, mute: false });
      expect(await updateMomentRelation(db, 'alice', 'bob', { mute: true })).toEqual({ hideFrom: true, mute: true });
      expect(await updateMomentRelation(db, 'alice', 'bob', { mute: true })).toEqual({ hideFrom: true, mute: true });
      expect(await updateMomentRelation(db, 'alice', 'bob', { hideFrom: false })).toEqual({ hideFrom: false, mute: true });
      await updateMomentRelation(db, 'alice', 'carol', { hideFrom: true });
      seed.block('alice', 'gone', 'hide_from');
      const blocks = await listMomentBlocks(db, 'alice');
      expect(blocks.hideFrom.map((person) => person.id)).toEqual(['carol']);
      expect(blocks.muted).toEqual([{ id: 'bob', displayName: 'Bob', avatarKey: 'avatar/bob/a.jpg' }]);
      expect(await listMomentBlocks(db, 'bob')).toEqual({ hideFrom: [], muted: [] });
    });

    it('turning 不让TA看 on drops the target’s notices on the member’s posts, and only those', async () => {
      seed.post('post_a', 'alice', { audience: 'club' });
      seed.post('post_c', 'carol', { audience: 'club' });
      createdComment(await postComment(db, reader('bob'), 'post_a', 'first'));
      createdComment(await postComment(db, reader('carol'), 'post_a', 'second'));
      createdComment(await postComment(db, reader('bob'), 'post_c', 'third'));
      createdComment(await postComment(db, reader('alice'), 'post_c', 'fourth'));
      const bobs = () => d1.rows("SELECT post_id, kind FROM moment_notices WHERE recipient_id = 'bob' ORDER BY post_id");
      const alices = () => d1.rows("SELECT post_id, kind, actor_id FROM moment_notices WHERE recipient_id = 'alice' ORDER BY post_id, actor_id");
      expect(bobs()).toEqual([
        { post_id: 'post_a', kind: 'thread' },
        { post_id: 'post_c', kind: 'thread' },
      ]);
      const alicesBefore = alices();
      expect((await readMomentBadge(db, reader('bob'))).unread).toBe(2);

      await updateMomentRelation(db, 'alice', 'bob', { mute: true });
      expect(bobs()).toHaveLength(2);
      d1.statements.length = 0;
      expect(await updateMomentRelation(db, 'alice', 'bob', { hideFrom: true })).toEqual({ hideFrom: true, mute: true });
      expect(bobs()).toEqual([{ post_id: 'post_c', kind: 'thread' }]);
      const drop = d1.statements.find((statement) => statement.sql.startsWith('DELETE FROM moment_notices'));
      const plan = d1.explain(drop!).join('\n');
      expect(plan).toMatch(/moment_notices_post/);
      expect(plan).toMatch(/posts_member/);
      const page = await listMomentNotices(db, reader('bob'), { cursor: null, unreadOnly: false });
      expect(page.notices.map((notice) => notice.post.id)).toEqual(['post_c']);
      expect(page.unread).toBe(1);
      expect(await readMomentBadge(db, reader('bob'))).toMatchObject({ unread: 1, latestActor: { id: 'alice' } });
      expect(alices()).toEqual(alicesBefore);
    });
  });

  describe('reports and moderation', () => {
    beforeEach(() => {
      people();
      seed.post('post_a', 'alice', { audience: 'club', body: 'reported text' });
      seed.media('post_a', 'moments/alice/med_r.jpg');
      seed.post('post_vic', 'vic', { audience: 'club' });
      seed.comment('pcm_bob', 'post_a', 'bob', { body: 'rude words' });
    });

    it('stores one report per member and item with a snapshot, and counts them for the daily cap', async () => {
      const report = { reporterId: 'dave', postId: 'post_a', commentId: null, targetMemberId: 'alice', reason: 'spam' as const, note: '广告' };
      await insertMomentReport(db, report);
      await insertMomentReport(db, { ...report, reason: 'other', note: null });
      await insertMomentReport(db, { ...report, commentId: 'pcm_bob', targetMemberId: 'bob', reason: 'harassment' });
      await insertMomentReport(db, { ...report, postId: 'post_missing' });
      const rows = d1.rows<{ comment_id: string | null; reason: string; snapshot_json: string }>('SELECT comment_id, reason, snapshot_json FROM moment_reports ORDER BY comment_id');
      expect(rows.map((row) => [row.comment_id, row.reason])).toEqual([
        [null, 'spam'],
        ['pcm_bob', 'harassment'],
      ]);
      expect(JSON.parse(rows[0]!.snapshot_json)).toEqual({
        body: 'reported text',
        media: [{ key: 'moments/alice/med_r.jpg', contentType: 'image/jpeg', kind: 'image', width: 100, height: 80, previewKey: null, durationMs: null }],
      });
      expect(JSON.parse(rows[1]!.snapshot_json)).toEqual({ body: 'rude words', media: [] });
      expect(await countReportsSince(db, 'dave', DAY_AGO())).toBe(2);
      expect(await countReportsSince(db, 'erin', DAY_AGO())).toBe(0);
    });

    it('lists the queue with counts, the content’s state and whether the moderator outranks the target', async () => {
      await insertMomentReport(db, { reporterId: 'dave', postId: 'post_a', commentId: null, targetMemberId: 'alice', reason: 'spam', note: null });
      await insertMomentReport(db, { reporterId: 'bob', postId: 'post_a', commentId: null, targetMemberId: 'alice', reason: 'privacy', note: null });
      await insertMomentReport(db, { reporterId: 'dave', postId: 'post_vic', commentId: null, targetMemberId: 'vic', reason: 'other', note: 'x' });
      const asErin = await listMomentReports(db, reader('erin', 'president'), { status: 'open', cursor: null });
      expect(asErin.reports).toHaveLength(3);
      const onAlice = asErin.reports.filter((item) => item.postId === 'post_a');
      expect(onAlice.map((item) => item.reportCount)).toEqual([2, 2]);
      expect(onAlice.every((item) => item.canResolve && item.current === 'live')).toBe(true);
      expect(asErin.reports.find((item) => item.postId === 'post_vic')).toMatchObject({ canResolve: false, target: { id: 'vic' }, reporter: { id: 'dave' }, note: 'x' });
      expect((await listMomentReports(db, reader('sam', 'superadmin'), { status: 'open', cursor: null })).reports.every((item) => item.canResolve)).toBe(true);

      const first = await listMomentReports(db, reader('erin', 'president'), { status: 'open', cursor: null, limit: 2 });
      const rest = await listMomentReports(db, reader('erin', 'president'), { status: 'open', cursor: first.nextCursor, limit: 2 });
      expect([...first.reports, ...rest.reports].map((item) => item.id)).toEqual(asErin.reports.map((item) => item.id));
      expect(rest.nextCursor).toBeNull();

      const record = await findMomentReport(db, asErin.reports[0]!.id);
      expect(record).toMatchObject({ status: 'open', commentId: null });
      expect(await findMomentReport(db, 'mrp_missing')).toBeNull();

      d1.rows("DELETE FROM posts WHERE id = 'post_vic'");
      const after = await listMomentReports(db, reader('erin', 'president'), { status: 'open', cursor: null });
      expect(after.reports.find((item) => item.postId === 'post_vic')?.current).toBe('deleted');
    });

    it('leaves reports about the moderator out of their own queue and lists them for the system admin', async () => {
      seed.post('post_erin', 'erin', { audience: 'club' });
      seed.comment('pcm_erin', 'post_a', 'erin', { body: 'erin says' });
      await insertMomentReport(db, { reporterId: 'dave', postId: 'post_erin', commentId: null, targetMemberId: 'erin', reason: 'harassment', note: '针对主席' });
      await insertMomentReport(db, { reporterId: 'bob', postId: 'post_a', commentId: 'pcm_erin', targetMemberId: 'erin', reason: 'other', note: '评论也是' });
      await insertMomentReport(db, { reporterId: 'dave', postId: 'post_a', commentId: null, targetMemberId: 'alice', reason: 'spam', note: null });
      await insertMomentReport(db, { reporterId: 'dave', postId: 'post_vic', commentId: null, targetMemberId: 'vic', reason: 'other', note: null });
      await insertMomentReport(db, { reporterId: 'dave', postId: 'post_a', commentId: 'pcm_bob', targetMemberId: 'bob', reason: 'harassment', note: null });

      const asErin = await listMomentReports(db, reader('erin', 'president'), { status: 'open', cursor: null });
      expect(asErin.reports.map((item) => item.target.id).sort()).toEqual(['alice', 'bob', 'vic']);
      const asSam = await listMomentReports(db, reader('sam', 'superadmin'), { status: 'open', cursor: null });
      const onErin = asSam.reports.filter((item) => item.target.id === 'erin');
      expect(onErin).toHaveLength(2);
      expect(onErin.every((item) => item.canResolve)).toBe(true);
      expect(onErin.map((item) => item.note).sort()).toEqual(['评论也是', '针对主席']);

      for (const moderator of [reader('erin', 'president'), reader('sam', 'superadmin')]) {
        const whole = moderator.id === 'erin' ? asErin : asSam;
        const paged: string[] = [];
        let cursor: MomentCursor | null = null;
        do {
          const page = await listMomentReports(db, moderator, { status: 'open', cursor, limit: 2 });
          paged.push(...page.reports.map((item) => item.id));
          cursor = page.nextCursor;
        } while (cursor);
        expect(paged).toEqual(whole.reports.map((item) => item.id));
      }
    });

    it('dismisses every open report on an item and logs it once', async () => {
      await insertMomentReport(db, { reporterId: 'dave', postId: 'post_a', commentId: null, targetMemberId: 'alice', reason: 'spam', note: null });
      await insertMomentReport(db, { reporterId: 'bob', postId: 'post_a', commentId: null, targetMemberId: 'alice', reason: 'spam', note: null });
      await insertMomentReport(db, { reporterId: 'dave', postId: 'post_a', commentId: 'pcm_bob', targetMemberId: 'bob', reason: 'spam', note: null });
      await dismissMomentReports(db, 'erin', { postId: 'post_a', commentId: null });
      await dismissMomentReports(db, 'erin', { postId: 'post_a', commentId: null });
      expect(d1.rows('SELECT comment_id, status, resolved_by FROM moment_reports ORDER BY comment_id, reporter_id')).toEqual([
        { comment_id: null, status: 'dismissed', resolved_by: 'erin' },
        { comment_id: null, status: 'dismissed', resolved_by: 'erin' },
        { comment_id: 'pcm_bob', status: 'open', resolved_by: null },
      ]);
      expect(d1.rows('SELECT action, target_member_id, comment_id FROM moment_actions')).toEqual([{ action: 'dismiss_report', target_member_id: 'alice', comment_id: null }]);
    });

    it('removes a post for everyone but its author, tells the author once, and restores it', async () => {
      await insertMomentReport(db, { reporterId: 'dave', postId: 'post_a', commentId: null, targetMemberId: 'alice', reason: 'spam', note: null });
      await insertMomentReport(db, { reporterId: 'dave', postId: 'post_a', commentId: 'pcm_bob', targetMemberId: 'bob', reason: 'spam', note: null });
      expect(await removeMomentPost(db, 'erin', 'post_a', '广告')).toEqual({ authorId: 'alice' });
      expect(await removeMomentPost(db, 'erin', 'post_a', 'again')).toEqual({ authorId: 'alice' });
      expect(await removeMomentPost(db, 'erin', 'post_missing', 'x')).toBeNull();

      expect(await findMomentPost(db, reader('dave'), 'post_a')).toBeNull();
      const own = await findMomentPost(db, reader('alice'), 'post_a');
      expect(own?.removed).toEqual({ at: expect.any(String), reason: '广告' });
      expect(own?.canInteract).toBe(false);
      expect(d1.rows("SELECT status FROM moment_reports ORDER BY comment_id")).toEqual([{ status: 'removed' }, { status: 'open' }]);
      expect(d1.rows('SELECT action, reason FROM moment_actions')).toEqual([{ action: 'remove_post', reason: '广告' }]);
      const [notice, ...others] = (await listMomentNotices(db, reader('alice'), { cursor: null, unreadOnly: false })).notices;
      expect(others).toEqual([]);
      expect(notice).toMatchObject({ kind: 'removed', actor: null, post: { id: 'post_a', available: true }, comment: null });

      expect(await restoreMomentPost(db, 'erin', 'post_a')).toBe(true);
      expect(await restoreMomentPost(db, 'erin', 'post_a')).toBe(false);
      expect(await findMomentPost(db, reader('dave'), 'post_a')).not.toBeNull();
      expect(d1.rows('SELECT action FROM moment_actions ORDER BY created_at, action')).toEqual([{ action: 'remove_post' }, { action: 'restore_post' }]);
      expect(d1.rows('SELECT COUNT(*) AS n FROM moment_notices')).toEqual([{ n: 0 }]);
    });

    it('removes a comment, replacing its notices with one for its author, and restores it', async () => {
      const reply = createdComment(await postComment(db, reader('carol'), 'post_a', 'shown in a push', { replyTo: 'pcm_bob' }));
      await insertMomentReport(db, { reporterId: 'dave', postId: 'post_a', commentId: reply.comment.id, targetMemberId: 'carol', reason: 'harassment', note: null });
      const removed = await removeMomentComment(db, 'erin', reply.comment.id, '辱骂');
      expect(removed).toEqual({ postId: 'post_a', authorId: 'carol', recallIds: ['alice', 'bob'] });
      expect(await removeMomentComment(db, 'erin', reply.comment.id, 'again')).toEqual({ postId: 'post_a', authorId: 'carol', recallIds: [] });
      expect(await removeMomentComment(db, 'erin', 'pcm_missing', 'x')).toBeNull();

      expect(d1.rows('SELECT recipient_id, actor_id, kind FROM moment_notices')).toEqual([{ recipient_id: 'carol', actor_id: null, kind: 'removed' }]);
      expect(d1.rows('SELECT status FROM moment_reports')).toEqual([{ status: 'removed' }]);
      expect((await findMomentPost(db, reader('dave'), 'post_a'))?.comments.map((comment) => comment.id)).toEqual(['pcm_bob']);
      const asCarol = await findMomentPost(db, reader('carol'), 'post_a');
      expect(asCarol?.comments.find((comment) => comment.id === reply.comment.id)?.removed).toEqual({ at: expect.any(String), reason: '辱骂' });
      const [notice] = (await listMomentNotices(db, reader('carol'), { cursor: null, unreadOnly: false })).notices;
      expect(notice).toMatchObject({ kind: 'removed', actor: null, comment: { id: reply.comment.id, body: null } });

      expect(await restoreMomentComment(db, 'erin', reply.comment.id)).toBe(true);
      expect(await restoreMomentComment(db, 'erin', reply.comment.id)).toBe(false);
      expect((await findMomentPost(db, reader('dave'), 'post_a'))?.comments.map((comment) => comment.id)).toEqual(['pcm_bob', reply.comment.id]);
      expect(d1.rows('SELECT COUNT(*) AS n FROM moment_notices')).toEqual([{ n: 0 }]);
      expect(d1.rows('SELECT action FROM moment_actions ORDER BY created_at, action')).toEqual([{ action: 'remove_comment' }, { action: 'restore_comment' }]);
    });

    it('lets a moderator act only on members of a lower tier', async () => {
      const asErin = await findMomentPost(db, reader('erin', 'president'), 'post_a');
      expect(asErin?.canModerate).toBe(true);
      expect(asErin?.comments[0]?.canModerate).toBe(true);
      expect((await findMomentPost(db, reader('erin', 'president'), 'post_vic'))?.canModerate).toBe(false);
      expect((await findMomentPost(db, reader('sam', 'superadmin'), 'post_vic'))?.canModerate).toBe(true);
      expect((await findMomentPost(db, reader('hank', 'head_events'), 'post_a'))?.canModerate).toBe(false);
      expect((await findMomentPost(db, reader('alice'), 'post_a'))?.comments[0]).toMatchObject({ canDelete: true, canModerate: false });
    });
  });
});
