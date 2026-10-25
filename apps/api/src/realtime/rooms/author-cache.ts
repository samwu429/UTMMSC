import type { AuthorCard } from '../../infrastructure/d1/members';

/**
 * How long a room trusts an author's name and avatar without reading D1 again. A change made through the profile
 * reaches the room at once through refreshAuthor, so this only bounds how long a missed refresh can show old data.
 * 房间在多长时间内信任作者的名字和头像而不再读取 D1。通过个人资料所做的修改会经 refreshAuthor 立即送到房间，
 * 所以这个时长只限制一次漏掉的刷新最多让旧信息显示多久。
 */
export const AUTHOR_CACHE_TTL_MS = 5 * 60 * 1000;

/** Authors kept per room; the least recently stored go first. */
/** 每个房间保留的作者数；最早存入的先被移除。 */
export const AUTHOR_CACHE_MAX = 500;

interface Entry {
  /** Null when D1 has no such member, so a deleted author is not looked up on every page. */
  /** D1 中没有这位成员时为 null，因此已删除的作者不会在每一页都被重新查询。 */
  card: AuthorCard | null;
  at: number;
}

export interface AuthorCacheOptions {
  ttlMs?: number;
  max?: number;
  now?: () => number;
}

/**
 * Current author names and avatars for history pages, kept in the Durable Object's memory. A history page then
 * reads D1 only for authors it has not seen in the last five minutes, so the page a room opens with usually costs
 * no D1 round trip. The memory goes when the object hibernates, which only means one more read later.
 * 历史页所用的作者当前名字和头像，保存在 Durable Object 的内存中。历史页因此只为最近五分钟内没见过的作者读取 D1，
 * 打开房间时的第一页通常不需要 D1 往返。对象休眠后内存清空，只是之后多读一次而已。
 */
export class AuthorCache {
  private readonly entries = new Map<string, Entry>();
  private readonly ttlMs: number;
  private readonly max: number;
  private readonly now: () => number;

  constructor(
    private readonly load: (ids: string[]) => Promise<Map<string, AuthorCard>>,
    options: AuthorCacheOptions = {},
  ) {
    this.ttlMs = options.ttlMs ?? AUTHOR_CACHE_TTL_MS;
    this.max = options.max ?? AUTHOR_CACHE_MAX;
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Cards for these ids: fresh entries from memory, the rest from D1 in one load. When D1 fails, any entry still in
   * memory is used however old, since it is newer than the name stored with the row; ids with none are left out
   * and the caller falls back to the row.
   * 这些 id 的作者信息：未过期的从内存取，其余一次从 D1 读取。D1 失败时，内存中仍有的条目无论多旧都会使用，因为它比行里存的名字更新；
   * 没有条目的 id 不返回，由调用方退回行里的值。
   */
  async cards(ids: readonly string[]): Promise<Map<string, AuthorCard>> {
    const now = this.now();
    const found = new Map<string, AuthorCard>();
    const missing: string[] = [];
    for (const id of new Set(ids)) {
      const entry = this.entries.get(id);
      if (entry && now - entry.at < this.ttlMs) {
        if (entry.card) found.set(id, entry.card);
      } else {
        missing.push(id);
      }
    }
    if (missing.length === 0) return found;

    let loaded: Map<string, AuthorCard>;
    try {
      loaded = await this.load(missing);
    } catch {
      for (const id of missing) {
        const card = this.entries.get(id)?.card;
        if (card) found.set(id, card);
      }
      return found;
    }
    for (const id of missing) {
      // A refresh that landed while D1 was being read is newer than what the read returned.
      // 读取 D1 期间到达的刷新比读取结果更新。
      const entry = this.entries.get(id);
      if (entry && entry.at >= now) {
        if (entry.card) found.set(id, entry.card);
        continue;
      }
      const card = loaded.get(id) ?? null;
      this.store(id, card, now);
      if (card) found.set(id, card);
    }
    return found;
  }

  /** The author changed their name or avatar; later pages use this without reading D1. */
  /** 作者修改了名字或头像；之后的页面直接使用它，不再读取 D1。 */
  put(id: string, card: AuthorCard): void {
    this.store(id, { displayName: card.displayName, avatarKey: card.avatarKey }, this.now());
  }

  get size(): number {
    return this.entries.size;
  }

  private store(id: string, card: AuthorCard | null, at: number): void {
    // Delete first, so the entry moves to the end of the insertion order and the oldest are evicted first.
    // 先删除，使条目移到插入顺序的末尾，最早存入的先被移除。
    this.entries.delete(id);
    this.entries.set(id, { card, at });
    while (this.entries.size > this.max) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}
