import {
  STICKERS_PER_MEMBER_MAX,
  STICKER_CLUB_EDITS_PER_DAY,
  STICKER_CLUB_LIVE_BYTES,
  STICKER_CLUB_UPLOADS_PER_DAY,
  STICKER_CLUB_UPLOAD_BYTES_PER_DAY,
  STICKER_EDITS_PER_DAY,
  STICKER_FULL_LISTS_PER_DAY,
  STICKER_LIVE_BYTES_PER_MEMBER,
  STICKER_PENDING_TTL_MS,
  STICKER_TYPES,
  STICKER_UNSENT_TTL_MS,
  STICKER_UPLOADS_PER_DAY,
  STICKER_UPLOAD_BYTES_PER_DAY,
  isStickerThumbToken,
  stickerObjectKey,
  stickerThumbKey,
  type StickerItem,
  type StickerType,
} from '@utmmsc/shared';

/**
 * Sticker collections (我的表情) and files in D1 (migration 0019). Every request is one batch, which D1 runs as one
 * transaction. A batch that a cap can refuse starts with a gate: an upsert of the member's sticker_daily row that
 * changes it only when every cap holds and writes a fresh token into it; every later statement carries the condition
 * that this row holds the token (`gated` below), so either all of them act or none does, and the last statement reads
 * which cap refused. No check runs outside the transaction, so parallel requests
 * on any number of isolates can never overrun a cap. Lists of ids are bound as one JSON parameter and read with
 * json_each, so no statement binds more than 14 values.
 * D1 中的表情列表（我的表情）和表情文件（迁移 0019）。每个请求都是一个批次，D1 把它作为一个事务执行。可能被上限拒绝的批次以闸门开始：
 * 对成员当天的 sticker_daily 行做一次插入或更新，只有所有上限都满足时才修改它，并写入一个新的令牌；之后的每条语句都带有
 * 「这一行持有该令牌」的条件（见下面的 `gated`），所以它们要么全部生效，要么全部不生效，最后一条语句读出是哪个上限拒绝了请求。没有任何检查在事务之外进行，因此无论有多少个隔离实例并行处理请求，都不会突破上限。
 * id 列表作为一个 JSON 参数绑定并用 json_each 读取，任何语句绑定的值都不超过 14 个。
 */

/** The member's row of the day and the request's token: what every gated statement checks. */
/** 成员当天的那一行和本次请求的令牌：每条受闸门控制的语句都检查它们。 */
export interface StickerGate {
  /** stickerDay(now), the club-local date. */
  /** stickerDay(now)，社团所在地的日期。 */
  day: string;
  /** crypto.randomUUID(), fresh for each request. */
  /** crypto.randomUUID()，每个请求都是新的。 */
  token: string;
}

/** A collection row joined with its file, as the list and the add outcome read it. */
/** 列表记录及其文件，即列表和添加结果读出的样子。 */
interface StickerRow {
  id: string;
  type: StickerType;
  width: number;
  height: number;
  bytes: number;
  animated: number;
  thumb: string | null;
  added_at: string;
}

export function toStickerItem(row: StickerRow): StickerItem {
  return {
    id: row.id,
    type: row.type,
    width: row.width,
    height: row.height,
    bytes: row.bytes,
    animated: row.animated === 1,
    thumb: row.thumb,
    addedAt: row.added_at,
  };
}

/**
 * Where an add or a move puts a sticker: the time in milliseconds times 1000, newest first. A move of several adds a
 * rank below 1000 on top, so no write needs to read the current largest value first.
 * 添加或移动时表情的位置：毫秒时间乘以 1000，最新的在前。多个一起移动时再加上小于 1000 的名次，因此任何写入都不必先读取当前的最大值。
 */
export function stickerPosition(nowMs: number): number {
  return nowMs * 1000;
}

/**
 * The gate condition for a statement that binds the member as ?1, with the day and the token at the given numbers.
 * It means the same as `(SELECT token ...) = <token>` (day and scope are the primary key), but SQLite checks an
 * EXISTS that names no outer table once, before the scan, so a statement whose gate failed reads no rows; the
 * comparison form is checked on every row it visits (measured on D1: 1,001 rows read against 2 for a refused list
 * of 999).
 * 某条把成员绑定为 ?1 的语句的闸门条件，日期和令牌使用给定的参数编号。它与 `(SELECT token ...) = <令牌>` 含义相同（day 和 scope 是主键），
 * 但 SQLite 对不引用外层表的 EXISTS 只在扫描之前判断一次，闸门未通过的语句因此不读取任何行；而比较的写法会在访问的每一行上判断
 * （在 D1 上测得：对 999 个表情的列表，被拒绝时读取 1,001 行，而这种写法只读 2 行）。
 */
function gated(day: number, token: number): string {
  return ` AND EXISTS (SELECT 1 FROM sticker_daily WHERE day = ?${day} AND scope = ?1 AND token = ?${token})`;
}

function flag(value: unknown): boolean {
  return value === 1 || value === true;
}

function count(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

/* The collection (GET /stickers) */
/* 表情列表（GET /stickers） */

export interface StickerListResult {
  /** The gate passed: the collection was read and counted against the day's full lists. */
  /** 闸门通过：读取了表情列表，并计入当天的完整列表次数。 */
  listed: boolean;
  version: number;
  stickers: StickerItem[];
}

/**
 * The member's collection, newest first, when the client holds another version (or none) and the day's full lists
 * are not used up; otherwise only the current version. A client whose version is current costs no list.
 * 当客户端持有的版本不同（或没有版本）且当天的完整列表次数未用完时，返回成员的表情列表，最新的在前；否则只返回当前版本号。
 * 客户端版本已是最新时不计入列表次数。
 */
export async function listStickers(
  db: D1Database,
  memberId: string,
  input: StickerGate & { version: number | null; limit?: number },
): Promise<StickerListResult> {
  const [, rows, state] = await db.batch([
    // L1. Gate a full list: only when the client's version differs, and within the daily list budget.
    // L1. 完整列表的闸门：仅当客户端的版本不同且未超过每日列表额度时通过。
    db
      .prepare(
        `INSERT INTO sticker_daily (day, scope, lists, token)
         SELECT ?1, ?2, 1, ?3
         WHERE COALESCE((SELECT version FROM sticker_counts WHERE scope = ?2), 0) IS NOT ?4
         ON CONFLICT (day, scope) DO UPDATE SET lists = lists + 1, token = excluded.token
         WHERE sticker_daily.lists < ?5`,
      )
      .bind(input.day, memberId, input.token, input.version, STICKER_FULL_LISTS_PER_DAY),
    // L2. The collection, newest first, read only when L1 passed (the EXISTS of the gate is checked once, before the scan).
    // L2. 表情列表，最新的在前；只在 L1 通过时读取（闸门的 EXISTS 在扫描前只判断一次）。
    db
      .prepare(
        `SELECT o.id, o.type, o.width, o.height, o.bytes, o.animated, m.thumb, m.added_at
         FROM member_stickers m JOIN sticker_objects o ON o.id = m.sticker_id
         WHERE m.member_id = ?1 AND o.state = 'ready' AND o.blocked_at IS NULL${gated(2, 3)}
         ORDER BY m.position DESC, m.added_at DESC, m.sticker_id
         LIMIT ?4`,
      )
      .bind(memberId, input.day, input.token, input.limit ?? STICKERS_PER_MEMBER_MAX),
    // L3. The version, and whether L1 passed.
    // L3. 版本号，以及 L1 是否通过。
    db
      .prepare(
        `SELECT COALESCE((SELECT version FROM sticker_counts WHERE scope = ?1), 0) AS version,
                (SELECT token FROM sticker_daily WHERE day = ?2 AND scope = ?1) = ?3 AS listed`,
      )
      .bind(memberId, input.day, input.token),
  ]);
  const head = (state?.results[0] ?? {}) as { version?: number; listed?: number | null };
  const listed = flag(head.listed);
  return { listed, version: count(head.version), stickers: listed ? ((rows?.results ?? []) as StickerRow[]).map(toStickerItem) : [] };
}

/* Adding a row: shared by upload (commit) and add */
/* 添加记录：上传（提交）和添加共用 */

interface AddRow {
  memberId: string;
  id: string;
  /** The still this member's grid shows for a new row; a row already there keeps its own. */
  /** 新记录在这位成员的表情格子中显示的静态图；已有的记录保留它自己的。 */
  thumb: string | null;
  nowMs: number;
  /** Marks the count C4 makes, for C5 and the outcome. */
  /** 标记 C4 所做的计数，供 C5 和结果读取使用。 */
  countToken: string;
}

/**
 * C3 to C6: move the row to the front when the member has it, else count it in and insert it while the file is
 * usable and there is room, then give the collection a new version when the row is there. With a gate, each one acts
 * only when the gate passed.
 * C3 到 C6：成员已有这一行时移到最前，否则在文件可用且列表未满时计入并插入，之后只要这一行存在就让表情列表得到新的版本号。
 * 带闸门时，每条语句都只在闸门通过时生效。
 */
function addRowStatements(db: D1Database, row: AddRow, gate: StickerGate | null): D1PreparedStatement[] {
  const position = stickerPosition(row.nowMs);
  const now = new Date(row.nowMs).toISOString();
  const gateBinds = gate ? [gate.day, gate.token] : [];
  return [
    // C3. Already in the collection: move it to the front.
    // C3. 已在列表中：移到最前。
    db
      .prepare(`UPDATE member_stickers SET position = ?3 WHERE member_id = ?1 AND sticker_id = ?2${gate ? gated(4, 5) : ''}`)
      .bind(row.memberId, row.id, position, ...gateBinds),
    // C4. Not in it yet: count it in while the file is usable and there is room; the token marks the count for C5.
    // C4. 尚未在列表中：文件可用且列表未满时计入；令牌为 C5 标记这次计数。
    db
      .prepare(
        `INSERT INTO sticker_counts (scope, items, token)
         SELECT ?1, 1, ?3
         WHERE NOT EXISTS (SELECT 1 FROM member_stickers WHERE member_id = ?1 AND sticker_id = ?2)
           AND EXISTS (SELECT 1 FROM sticker_objects WHERE id = ?2 AND state = 'ready' AND blocked_at IS NULL)${gate ? gated(5, 6) : ''}
         ON CONFLICT (scope) DO UPDATE SET items = items + 1, token = excluded.token WHERE sticker_counts.items < ?4`,
      )
      .bind(row.memberId, row.id, row.countToken, STICKERS_PER_MEMBER_MAX, ...gateBinds),
    // C5. Insert the row C4 counted.
    // C5. 插入 C4 计入的那一行。
    db
      .prepare(
        `INSERT INTO member_stickers (member_id, sticker_id, thumb, position, added_at)
         SELECT ?1, ?2, ?3, ?4, ?5 WHERE (SELECT token FROM sticker_counts WHERE scope = ?1) = ?6${gate ? gated(7, 8) : ''}`,
      )
      .bind(row.memberId, row.id, row.thumb, position, now, row.countToken, ...gateBinds),
    // C6. Every change gives the collection a new version (none when the row is not there: nothing changed).
    // C6. 每次变化都让表情列表得到新的版本号（这一行不存在时什么也没变，不加）。
    db
      .prepare(
        `UPDATE sticker_counts SET version = version + 1
         WHERE scope = ?1 AND EXISTS (SELECT 1 FROM member_stickers WHERE member_id = ?1 AND sticker_id = ?2)${gate ? gated(3, 4) : ''}`,
      )
      .bind(row.memberId, row.id, ...gateBinds),
  ];
}

/**
 * C7, extended: the row as it now stands, whether C4 counted it, the file's state, the total and the version; with a
 * gate also whether it passed and the member's and the club's edits of the day, to name the cap that refused.
 * C7 的扩展：现在的记录、C4 是否计入、文件状态、总数和版本号；带闸门时还有闸门是否通过，以及成员和全会当天的整理次数，用来说明是哪个上限拒绝了请求。
 */
function addOutcomeStatement(db: D1Database, row: AddRow, gate: StickerGate | null): D1PreparedStatement {
  const gateColumns = gate
    ? `,
       (SELECT token FROM sticker_daily WHERE day = ?4 AND scope = ?1) = ?5 AS gated,
       (SELECT edits FROM sticker_daily WHERE day = ?4 AND scope = ?1) AS edits,
       (SELECT edits FROM sticker_daily WHERE day = ?4 AND scope = '*') AS club_edits`
    : '';
  return db
    .prepare(
      `SELECT o.id, o.type, o.width, o.height, o.bytes, o.animated, m.thumb, m.added_at,
              o.id IS NOT NULL AS found, o.state, o.blocked_at IS NOT NULL AS blocked,
              (SELECT token FROM sticker_counts WHERE scope = ?1) = ?3 AS added,
              COALESCE((SELECT items FROM sticker_counts WHERE scope = ?1), 0) AS total,
              COALESCE((SELECT version FROM sticker_counts WHERE scope = ?1), 0) AS version${gateColumns}
       FROM (SELECT 1) LEFT JOIN sticker_objects o ON o.id = ?2
       LEFT JOIN member_stickers m ON m.member_id = ?1 AND m.sticker_id = ?2`,
    )
    .bind(row.memberId, row.id, row.countToken, ...(gate ? [gate.day, gate.token] : []));
}

/** Why a file could not go into a collection, from the outcome read. */
/** 文件为什么不能加入表情列表，由结果读取得出。 */
export type StickerFileState = 'missing' | 'blocked' | 'unready' | 'ready';

export type StickerAddResult =
  | { outcome: 'added' | 'moved'; sticker: StickerItem; total: number; version: number }
  | { outcome: 'refused'; file: StickerFileState; total: number; version: number };

interface AddOutcomeRow extends Omit<StickerRow, 'id' | 'type' | 'added_at'> {
  id: string | null;
  type: StickerType | null;
  added_at: string | null;
  found: number;
  state: string | null;
  blocked: number | null;
  added: number | null;
  total: number;
  version: number;
  gated?: number | null;
  edits?: number | null;
  club_edits?: number | null;
}

function addResult(row: AddOutcomeRow | undefined): StickerAddResult {
  const total = count(row?.total);
  const version = count(row?.version);
  if (row && row.added_at !== null && row.id !== null && row.type !== null) {
    const sticker = toStickerItem({ ...row, id: row.id, type: row.type, added_at: row.added_at });
    return { outcome: flag(row.added) ? 'added' : 'moved', sticker, total, version };
  }
  let file: StickerFileState = 'ready';
  if (!row || !flag(row.found)) file = 'missing';
  else if (flag(row.blocked)) file = 'blocked';
  else if (row.state !== 'ready') file = 'unready';
  return { outcome: 'refused', file, total, version };
}

/* The edit gate: add, front and remove */
/* 整理闸门：添加、移到最前和删除 */

/**
 * E1 and E2: count n edits against the member's day when the member's and the club's budgets hold, and the club's
 * day under the same token.
 * E1 和 E2：成员和全会的额度都足够时，把 n 次整理计入成员当天的额度，并以同一个令牌计入全会当天的计数。
 */
function editGate(db: D1Database, memberId: string, gate: StickerGate, n: number): D1PreparedStatement[] {
  return [
    // E1. Gate: count n edits against the member's day when the member's and the club's budgets hold.
    // E1. 闸门：成员和全会的额度都足够时，把 n 次整理计入成员当天的额度。
    db
      .prepare(
        `INSERT INTO sticker_daily (day, scope, edits, token)
         SELECT ?1, ?2, ?3, ?4
         WHERE COALESCE((SELECT edits FROM sticker_daily WHERE day = ?1 AND scope = '*'), 0) + ?3 <= ?6
         ON CONFLICT (day, scope) DO UPDATE SET edits = edits + excluded.edits, token = excluded.token
         WHERE sticker_daily.edits + excluded.edits <= ?5`,
      )
      .bind(gate.day, memberId, n, gate.token, STICKER_EDITS_PER_DAY, STICKER_CLUB_EDITS_PER_DAY),
    // E2. The club's day, under the same token.
    // E2. 全会当天的计数，同一个令牌。
    db
      .prepare(
        `INSERT INTO sticker_daily (day, scope, edits)
         SELECT ?1, '*', ?3 WHERE (SELECT token FROM sticker_daily WHERE day = ?1 AND scope = ?2) = ?4
         ON CONFLICT (day, scope) DO UPDATE SET edits = edits + excluded.edits`,
      )
      .bind(gate.day, memberId, n, gate.token),
  ];
}

/** Which budget refused an edit gate: the member's own when it is spent, else the club's. */
/** 是哪项额度拒绝了整理闸门：成员自己的额度用完时是成员的，否则是全会的。 */
export type StickerEditRefusal = 'edits' | 'clubLimit';

function editRefusal(edits: unknown, n: number): StickerEditRefusal {
  return count(edits) + n > STICKER_EDITS_PER_DAY ? 'edits' : 'clubLimit';
}

/** Columns every edit batch's last statement reads, with the member as ?1, the day as ?2 and the token as ?3. */
/** 每个整理批次最后一条语句读取的列，成员为 ?1，日期为 ?2，令牌为 ?3。 */
const EDIT_STATE = `(SELECT token FROM sticker_daily WHERE day = ?2 AND scope = ?1) = ?3 AS gated,
       (SELECT edits FROM sticker_daily WHERE day = ?2 AND scope = ?1) AS edits,
       COALESCE((SELECT version FROM sticker_counts WHERE scope = ?1), 0) AS version`;

/* POST /stickers/add */
/* 添加已存储的表情 */

export type StickerAddOutcome = StickerAddResult | { outcome: 'limited'; refusal: StickerEditRefusal };

/**
 * Adds a stored file to the member's collection (a received sticker): one row, no R2. The edit gate with n = 1, then
 * C3 to C6 under the gate, then the outcome. A file already there moves to the front and keeps its own still.
 * 把已存储的文件加入成员的表情列表（收到的表情）：只写一行，不访问 R2。先是 n = 1 的整理闸门，然后是受闸门控制的 C3 到 C6，最后读取结果。
 * 已有的文件移到最前，并保留它自己的静态图。
 */
export async function addSticker(
  db: D1Database,
  input: { memberId: string; id: string; thumb: string | null; nowMs: number; gate: StickerGate; countToken: string },
): Promise<StickerAddOutcome> {
  const row: AddRow = { memberId: input.memberId, id: input.id, thumb: input.thumb, nowMs: input.nowMs, countToken: input.countToken };
  const results = await db.batch([
    ...editGate(db, input.memberId, input.gate, 1),
    ...addRowStatements(db, row, input.gate),
    addOutcomeStatement(db, row, input.gate),
  ]);
  const outcome = results[results.length - 1]?.results[0] as AddOutcomeRow | undefined;
  if (!flag(outcome?.gated)) return { outcome: 'limited', refusal: editRefusal(outcome?.edits, 1) };
  return addResult(outcome);
}

/* POST /stickers/front */
/* 移到最前 */

export type StickerFrontResult = { outcome: 'moved'; moved: number; version: number } | { outcome: 'limited'; refusal: StickerEditRefusal };

/**
 * Moves the given ids to the front, the first one first, ignoring ids not in the collection. One primary-key lookup
 * per id with the JSON read once for the list; each row's rank comes from a JSON path lookup that reads no table rows.
 * `ids` must already be deduplicated and valid (ids are [A-Za-z0-9_-] only, so the quoted path is safe).
 * 把给定的 id 移到最前，第一个排在最前，不在列表中的 id 被忽略。每个 id 一次主键查找，JSON 只为列表读取一次；每一行的名次通过 JSON 路径查找得到，
 * 不读取任何表行。`ids` 必须已经去重且有效（id 只含 [A-Za-z0-9_-]，因此加引号的路径是安全的）。
 */
export async function moveStickersToFront(
  db: D1Database,
  input: { memberId: string; ids: readonly string[]; nowMs: number; gate: StickerGate },
): Promise<StickerFrontResult> {
  const n = input.ids.length;
  const ranks = JSON.stringify(Object.fromEntries(input.ids.map((id, index) => [id, n - index])));
  const { memberId, gate } = input;
  const [, , moved, , state] = await db.batch([
    ...editGate(db, memberId, gate, n),
    // F1. One primary-key lookup per id, the JSON read once for the list; each row's rank comes from a JSON path lookup.
    // F1. 每个 id 一次主键查找，JSON 只为列表读取一次；每一行的名次通过 JSON 路径查找得到。
    db
      .prepare(
        `UPDATE member_stickers SET position = ?3 + json_extract(?4, '$."' || sticker_id || '"')
         WHERE member_id = ?1 AND sticker_id IN (SELECT key FROM json_each(?4))${gated(2, 5)}`,
      )
      .bind(memberId, gate.day, stickerPosition(input.nowMs), ranks, gate.token),
    // F2. A new version when the gate passed.
    // F2. 闸门通过时得到新的版本号。
    db
      .prepare(`UPDATE sticker_counts SET version = version + 1 WHERE scope = ?1${gated(2, 3)}`)
      .bind(memberId, gate.day, gate.token),
    // F3. Whether the gate passed, and the version.
    // F3. 闸门是否通过，以及版本号。
    db.prepare(`SELECT ${EDIT_STATE}`).bind(memberId, gate.day, gate.token),
  ]);
  const head = (state?.results[0] ?? {}) as { gated?: number | null; edits?: number | null; version?: number };
  if (!flag(head.gated)) return { outcome: 'limited', refusal: editRefusal(head.edits, n) };
  return { outcome: 'moved', moved: moved?.meta.changes ?? 0, version: count(head.version) };
}

/* POST /stickers/remove */
/* 删除 */

export type StickerRemoveResult =
  | { outcome: 'removed'; removed: number; total: number; version: number }
  | { outcome: 'limited'; refusal: StickerEditRefusal };

/**
 * Removes the given ids from the member's collection, taking them off the total before they go. Rows only: a file
 * goes only through the sweep or a block, never here.
 * 从成员的表情列表中删除给定的 id，删除之前先从总数中减去。只动记录：文件只会被清理任务或封禁删除，这里从不删除文件。
 */
export async function removeStickers(
  db: D1Database,
  input: { memberId: string; ids: readonly string[]; gate: StickerGate },
): Promise<StickerRemoveResult> {
  const n = input.ids.length;
  const ids = JSON.stringify(input.ids);
  const { memberId, gate } = input;
  const [, , , removed, state] = await db.batch([
    ...editGate(db, memberId, gate, n),
    // D1. Take the rows about to go off the total, before they go.
    // D1. 先把即将删除的行数从总数中减去。
    db
      .prepare(
        `UPDATE sticker_counts
         SET items = items - (SELECT COUNT(*) FROM member_stickers
                              WHERE member_id = ?1 AND sticker_id IN (SELECT value FROM json_each(?2))),
             version = version + 1
         WHERE scope = ?1${gated(3, 4)}`,
      )
      .bind(memberId, ids, gate.day, gate.token),
    // D2. Delete them.
    // D2. 删除它们。
    db
      .prepare(`DELETE FROM member_stickers WHERE member_id = ?1 AND sticker_id IN (SELECT value FROM json_each(?2))${gated(3, 4)}`)
      .bind(memberId, ids, gate.day, gate.token),
    // D3. Whether the gate passed, the total and the version.
    // D3. 闸门是否通过、总数和版本号。
    db
      .prepare(`SELECT ${EDIT_STATE}, COALESCE((SELECT items FROM sticker_counts WHERE scope = ?1), 0) AS total`)
      .bind(memberId, gate.day, gate.token),
  ]);
  const head = (state?.results[0] ?? {}) as { gated?: number | null; edits?: number | null; version?: number; total?: number };
  if (!flag(head.gated)) return { outcome: 'limited', refusal: editRefusal(head.edits, n) };
  return { outcome: 'removed', removed: removed?.meta.changes ?? 0, total: count(head.total), version: count(head.version) };
}

/* POST /stickers/upload */
/* 上传表情 */

/** One checked upload, as the route sniffed and named it. */
/** 一次已检查的上传，即接口嗅探并命名后的样子。 */
export interface StickerUpload {
  memberId: string;
  id: string;
  type: StickerType;
  width: number;
  height: number;
  animated: boolean;
  /** Bytes of the sticker file alone. */
  /** 仅表情文件本身的字节数。 */
  fileBytes: number;
  /** Bytes of the whole request: the still and the file. */
  /** 整个请求的字节数：静态缩略图加表情文件。 */
  requestBytes: number;
  /** The still's token (stickerThumbToken), recorded by the reserve before the still is written. */
  /** 静态缩略图的令牌（stickerThumbToken），由预留批次在写入静态缩略图之前记录。 */
  thumb: string;
  nowMs: number;
  gate: StickerGate;
}

/** What the reserve batch saw: whether it passed, the file and every count its gate checked. */
/** 预留批次看到的情况：是否通过、文件状态，以及闸门检查过的每个计数。 */
export interface StickerReservation {
  reserved: boolean;
  /** The file's row after the batch; null when there is none. */
  /** 批次之后文件的记录状态；没有记录时为 null。 */
  state: 'pending' | 'ready' | 'deleting' | null;
  blocked: boolean;
  /** The member already has the sticker: the upload moves it and keeps its still. */
  /** 成员已有这个表情：本次上传只移动它，并保留它的静态图。 */
  mine: boolean;
  /**
   * The still the member's row shows when they already have the sticker. Such an upload writes no still, so a commit
   * that puts the row back (removed meanwhile) puts back this one, never this request's.
   * 成员已有这个表情时，其记录显示的静态图。这样的上传不写入静态缩略图，因此如果记录在此期间被删除、提交时重新加入，
   * 放回的是这一张，而不是本次请求的静态缩略图。
   */
  keptThumb: string | null;
  /** This request wrote the file's pending row (R4), so its bytes are on this member's and the club's totals. */
  /** 文件的 pending 记录是本次请求写入的（R4），因此它的字节数已计入这位成员和全会的累计数。 */
  created: boolean;
  /** The size the file's row records; null when there is none. */
  /** 文件记录中的字节数；没有记录时为 null。 */
  recordedBytes: number | null;
  /**
   * A row names this upload's still (the file and the thumb), so R5 did not charge it. Read after the batch: it says
   * what R1 saw only for a refused reserve, where R6 did nothing; after a reserve that passed, R6 has just recorded it.
   * 已有记录指向本次上传的静态缩略图（文件和令牌都相同），因此 R5 没有计入它。在批次之后读取：只有对被拒绝的预留，它才说明 R1 看到的情况，
   * 因为那时 R6 什么也没做；对通过的预留，R6 刚刚记录了它。
   */
  stillRecorded: boolean;
  items: number;
  uploads: number;
  uploadBytes: number;
  clubUploads: number;
  clubUploadBytes: number;
  liveBytes: number;
  clubLiveBytes: number;
}

interface ReservationRow {
  reserved: number | null;
  state: StickerReservation['state'];
  blocked: number | null;
  mine: number;
  kept_thumb: string | null;
  created: number | null;
  bytes: number | null;
  still_recorded: number | null;
  items: number;
  uploads: number | null;
  upload_bytes: number | null;
  club_uploads: number | null;
  club_upload_bytes: number | null;
  live_bytes: number | null;
  club_live_bytes: number | null;
}

/**
 * The reserve batch, R1 to R7: charge the member's and the club's day when every cap holds, write a pending row for a
 * new file (swept after an hour if the upload never finishes) and put its bytes on the member's and the club's
 * running totals, record this upload's still unless the member already has the sticker, putting its bytes on the same
 * totals when no row named it yet, and hold that row, then probe. The storage caps count exactly what the batch and the
 * commit charge, so a still a row already names needs no room. The still is recorded before it is written, so whatever
 * happens to the request afterwards, the sweep or a block finds its key, and no discard takes a row while this upload
 * holds it. A row already there has its sweep moved to at least an hour from now (R4), so the sweep never takes the row
 * while this upload may still write under it; a pending one also counts this reserve, so the request that wrote it
 * never discards it: this upload may store the original under it. A pending row left by an unfinished upload of the
 * same size counts as existing: its bytes are already on its creator's total. One that records another size was written
 * for bytes R2 refused, so it spares no storage: the storage caps apply as for a new file, and the commit makes the file
 * this member's.
 * 预留批次 R1 到 R7：所有上限都满足时计入成员和全会当天的额度，为新文件写入 pending 记录（上传一直没有完成的话一小时后被清理），
 * 并把它的字节数计入成员和全会的累计数；成员还没有这个表情时记录本次上传的静态缩略图，还没有记录指向它时把它的字节数计入同样的累计数，
 * 并持有这条记录；最后探查。存储上限检查的恰好是这个批次和提交将要计入的字节，因此已有记录指向的静态缩略图不需要任何空间。
 * 静态缩略图在写入之前就已记录，因此无论这个请求之后发生什么，清理任务或封禁都能找到它的键，而在本次上传持有这条记录期间，任何丢弃都不会删除它。
 * 已有记录的清理时间至少推迟到一小时之后（R4），因此在本次上传仍可能在它之下写入期间，清理任务不会删除这条记录；pending 的记录还会计入这次预留，
 * 因此写入它的请求永远不会丢弃它：本次上传可能在它之下存下原始文件。
 * 大小相同的未完成上传留下的 pending 记录视为已存在：它的字节数已计入其创建者的累计数。记录的大小不同的 pending 记录是为被 R2 拒绝的字节写下的，
 * 不能省下任何存储空间：存储上限按新文件检查，提交时文件归这位成员所有。
 */
export async function reserveStickerUpload(db: D1Database, upload: StickerUpload): Promise<StickerReservation> {
  const { memberId, id, gate } = upload;
  const now = new Date(upload.nowMs).toISOString();
  const stillBytes = upload.requestBytes - upload.fileBytes;
  const results = await db.batch([
    // R1. Gate: count this upload against the member's day when every cap holds. A member who does not have the sticker
    // yet needs storage for what this upload will charge, on the same conditions as the charges: the still (?5 - ?6)
    // unless a row names it already (R5), and the file (?6) unless a row accounts for it, a stored one or a pending one
    // of the same size (R3, C0). An upload that charges nothing is never refused for storage, like one by a member who
    // has the sticker, even when a total already sits over its cap: so a retry after a failure, a pick again after a
    // removal, or a still another uploader recorded costs no room it will not use.
    // R1. 闸门：所有上限都满足时，把这次上传计入成员当天的额度。还没有这个表情的成员需要为这次上传将要计入的字节留出存储空间，条件与计入时相同：
    // 静态缩略图（?5 - ?6），除非已有记录指向它（R5）；文件本身（?6），除非已有记录计入了它，即已存储的记录或大小相同的 pending 记录（R3、C0）。
    // 什么也不计入的上传从不因存储空间被拒绝，与已有这个表情的成员一样，即使某个累计数已经超过上限：因此失败后的重试、删除后再次选择，
    // 或别的上传者已记录过的静态缩略图，都不会占用它用不到的空间。
    db
      .prepare(
        `INSERT INTO sticker_daily (day, scope, uploads, upload_bytes, token)
         SELECT ?1, ?2, 1, ?5, ?4
         WHERE NOT EXISTS (SELECT 1 FROM sticker_objects WHERE id = ?3 AND (blocked_at IS NOT NULL OR state = 'deleting'))
           AND (EXISTS (SELECT 1 FROM member_stickers WHERE member_id = ?2 AND sticker_id = ?3)
                OR COALESCE((SELECT items FROM sticker_counts WHERE scope = ?2), 0) < ?7)
           AND COALESCE((SELECT uploads FROM sticker_daily WHERE day = ?1 AND scope = '*'), 0) < ?10
           AND COALESCE((SELECT upload_bytes FROM sticker_daily WHERE day = ?1 AND scope = '*'), 0) + ?5 <= ?11
           AND (EXISTS (SELECT 1 FROM member_stickers WHERE member_id = ?2 AND sticker_id = ?3)
                OR (SELECT need = 0
                           OR (COALESCE((SELECT live_bytes FROM sticker_counts WHERE scope = ?2), 0) + need <= ?12
                               AND COALESCE((SELECT live_bytes FROM sticker_counts WHERE scope = '*'), 0) + need <= ?13)
                    FROM (SELECT CASE WHEN EXISTS (SELECT 1 FROM sticker_thumbs WHERE sticker_id = ?3 AND thumb = ?14) THEN 0 ELSE ?5 - ?6 END
                                 + CASE WHEN EXISTS (SELECT 1 FROM sticker_objects WHERE id = ?3 AND (state <> 'pending' OR bytes = ?6))
                                        THEN 0 ELSE ?6 END AS need)))
         ON CONFLICT (day, scope) DO UPDATE
         SET uploads = uploads + 1, upload_bytes = upload_bytes + excluded.upload_bytes, token = excluded.token
         WHERE sticker_daily.uploads < ?8 AND sticker_daily.upload_bytes + excluded.upload_bytes <= ?9`,
      )
      .bind(
        gate.day,
        memberId,
        id,
        gate.token,
        upload.requestBytes,
        upload.fileBytes,
        STICKERS_PER_MEMBER_MAX,
        STICKER_UPLOADS_PER_DAY,
        STICKER_UPLOAD_BYTES_PER_DAY,
        STICKER_CLUB_UPLOADS_PER_DAY,
        STICKER_CLUB_UPLOAD_BYTES_PER_DAY,
        STICKER_LIVE_BYTES_PER_MEMBER,
        STICKER_CLUB_LIVE_BYTES,
        upload.thumb,
      ),
    // R2. The club's day, under the same token.
    // R2. 全会当天的计数，同一个令牌。
    db
      .prepare(
        `INSERT INTO sticker_daily (day, scope, uploads, upload_bytes)
         SELECT ?1, '*', 1, ?4 WHERE (SELECT token FROM sticker_daily WHERE day = ?1 AND scope = ?2) = ?3
         ON CONFLICT (day, scope) DO UPDATE SET uploads = uploads + 1, upload_bytes = upload_bytes + excluded.upload_bytes`,
      )
      .bind(gate.day, memberId, gate.token, upload.requestBytes),
    // R3. A new file's bytes, on the member's and the club's running totals, when R4 is about to write its row: the gate
    // passed and there is no row yet. Checked before the insert, in the same transaction, so the bytes are charged
    // exactly once, by the request that writes the row (a mark read after the insert could also match a request of the
    // same member in the same millisecond).
    // R3. R4 即将写入新文件的记录时（闸门已通过且还没有记录），把它的字节数计入成员和全会的累计数。在同一个事务中、插入之前检查，
    // 因此字节数恰好计入一次，由写入记录的那个请求计入（插入之后再读取标记的话，同一成员在同一毫秒的另一个请求也可能与之匹配）。
    db
      .prepare(
        `INSERT INTO sticker_counts (scope, live_bytes)
         SELECT value, ?3 FROM json_each(json_array(?1, '*'))
         WHERE NOT EXISTS (SELECT 1 FROM sticker_objects WHERE id = ?2)${gated(4, 5)}
         ON CONFLICT (scope) DO UPDATE SET live_bytes = live_bytes + excluded.live_bytes`,
      )
      .bind(memberId, id, upload.fileBytes, gate.day, gate.token),
    // R4. A new file: its pending row, swept an hour (STICKER_PENDING_TTL_MS) after this reserve if the upload never
    // finishes. A row already there, pending or ready (R1 refused any other), has its sweep moved to at least that hour,
    // so the sweep never claims a row an upload in flight reserved over: everything an upload does after its reserve (a
    // few D1 batches, at most two R2 puts and one delete, its cleanup under waitUntil included) takes seconds, far inside
    // the hour. A scalar MAX with a NULL argument is NULL, so a sweep_at of NULL stays NULL (never swept). A pending row
    // also counts this reserve (reserves), since this upload may write the original under it from now on: its creator
    // then leaves it to this upload's commit or the sweep, even when it was written by the same member in the same
    // millisecond (R7 marks both as created). A ready row's count stays as it is.
    // R4. 新文件：写入 pending 记录；上传一直没有完成的话，在这次预留一小时（STICKER_PENDING_TTL_MS）之后由清理任务删除。已有的记录
    // （pending 或 ready，其他状态已被 R1 拒绝）的清理时间至少推迟到这一小时之后，因此清理任务永远不会认领正在进行的上传在其之上预留的记录：
    // 上传在预留之后做的一切（几个 D1 批次、最多两次 R2 写入和一次删除，包括 waitUntil 中的清理）只需几秒钟，远在一小时之内。
    // 有 NULL 参数的标量 MAX 结果为 NULL，因此为 NULL 的 sweep_at 仍为 NULL（永远不被清理）。pending 的记录还会计入这次预留（reserves），
    // 因为从现在起本次上传可能在它之下写入原始文件：其创建者因此把它留给本次上传的提交或清理任务，即使它是同一位成员在同一毫秒写入的
    // （R7 把两者都标记为新建）。ready 记录的计数保持不变。
    db
      .prepare(
        `INSERT INTO sticker_objects (id, type, width, height, bytes, animated, state, created_by, created_at, sweep_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, 'pending', ?7, ?8, ?9
         WHERE (SELECT token FROM sticker_daily WHERE day = ?10 AND scope = ?7) = ?11
         ON CONFLICT (id) DO UPDATE
         SET reserves = reserves + (sticker_objects.state = 'pending'), sweep_at = MAX(sticker_objects.sweep_at, excluded.sweep_at)`,
      )
      .bind(
        id,
        upload.type,
        upload.width,
        upload.height,
        upload.fileBytes,
        upload.animated ? 1 : 0,
        memberId,
        now,
        new Date(upload.nowMs + STICKER_PENDING_TTL_MS).toISOString(),
        gate.day,
        gate.token,
      ),
    // R5. The still's bytes, on the member's and the club's running totals, when R6 is about to record it: the member
    // does not have the sticker and no row names this still yet. Checked before the insert, in the same transaction, so
    // a still is charged exactly once, by the upload that records it.
    // R5. R6 即将记录静态缩略图时（成员还没有这个表情，且还没有记录指向这张静态缩略图），把它的字节数计入成员和全会的累计数。
    // 在同一个事务中、插入之前检查，因此每张静态缩略图恰好计入一次，由记录它的那次上传计入。
    db
      .prepare(
        `INSERT INTO sticker_counts (scope, live_bytes)
         SELECT value, ?4 FROM json_each(json_array(?1, '*'))
         WHERE NOT EXISTS (SELECT 1 FROM member_stickers WHERE member_id = ?1 AND sticker_id = ?2)
           AND NOT EXISTS (SELECT 1 FROM sticker_thumbs WHERE sticker_id = ?2 AND thumb = ?3)${gated(5, 6)}
         ON CONFLICT (scope) DO UPDATE SET live_bytes = live_bytes + excluded.live_bytes`,
      )
      .bind(memberId, id, upload.thumb, stillBytes, gate.day, gate.token),
    // R6. Record the still before it is written, so the sweep and a block always know its key (deleting a key that was
    // never written is harmless), and hold the row until this upload writes the still or gives up. A still already
    // recorded, by anyone, keeps its creator, time and bytes and gains this upload's hold (a kept row, NULL, stays kept).
    // R6. 在写入之前记录静态缩略图，清理任务和封禁因此总能知道它的键（删除一个从未写入的键没有任何害处），并持有这条记录，直到本次上传写入
    // 静态缩略图或放弃。已被任何人记录过的静态缩略图保留其创建者、时间和字节数，并加上本次上传的持有（保留的记录，即 NULL，仍然保留）。
    db
      .prepare(
        `INSERT INTO sticker_thumbs (sticker_id, thumb, created_at, bytes, created_by, holders)
         SELECT ?2, ?3, ?4, ?5, ?1, 1
         WHERE NOT EXISTS (SELECT 1 FROM member_stickers WHERE member_id = ?1 AND sticker_id = ?2)${gated(6, 7)}
         ON CONFLICT (sticker_id, thumb) DO UPDATE SET holders = holders + 1`,
      )
      .bind(memberId, id, upload.thumb, now, stillBytes, gate.day, gate.token),
    // R7. Probe: whether R1 passed, the file's state, whether the member has it and with which still, whether R4 wrote
    // its row (by the creator and time it writes), the size the row records, whether a row names this upload's still,
    // and every count R1 checked.
    // R7. 探查：R1 是否通过、文件状态、成员是否已有以及显示哪张静态图、R4 是否写入了它的记录（按它写入的创建者和时间判断）、记录中的字节数、
    // 是否已有记录指向本次上传的静态缩略图，以及 R1 检查过的每个计数。
    db
      .prepare(
        `SELECT (SELECT token FROM sticker_daily WHERE day = ?1 AND scope = ?2) = ?3 AS reserved,
                o.state, o.blocked_at IS NOT NULL AS blocked,
                m.member_id IS NOT NULL AS mine, m.thumb AS kept_thumb,
                o.state = 'pending' AND o.created_by = ?2 AND o.created_at = ?5 AS created,
                o.bytes,
                EXISTS (SELECT 1 FROM sticker_thumbs WHERE sticker_id = ?4 AND thumb = ?6) AS still_recorded,
                COALESCE((SELECT items FROM sticker_counts WHERE scope = ?2), 0) AS items,
                (SELECT uploads FROM sticker_daily WHERE day = ?1 AND scope = ?2) AS uploads,
                (SELECT upload_bytes FROM sticker_daily WHERE day = ?1 AND scope = ?2) AS upload_bytes,
                (SELECT uploads FROM sticker_daily WHERE day = ?1 AND scope = '*') AS club_uploads,
                (SELECT upload_bytes FROM sticker_daily WHERE day = ?1 AND scope = '*') AS club_upload_bytes,
                (SELECT live_bytes FROM sticker_counts WHERE scope = ?2) AS live_bytes,
                (SELECT live_bytes FROM sticker_counts WHERE scope = '*') AS club_live_bytes
         FROM (SELECT 1) LEFT JOIN sticker_objects o ON o.id = ?4
         LEFT JOIN member_stickers m ON m.member_id = ?2 AND m.sticker_id = ?4`,
      )
      .bind(gate.day, memberId, gate.token, id, now, upload.thumb),
  ]);
  const row = results[results.length - 1]?.results[0] as ReservationRow | undefined;
  return {
    reserved: flag(row?.reserved),
    state: row?.state ?? null,
    blocked: flag(row?.blocked),
    mine: flag(row?.mine),
    keptThumb: typeof row?.kept_thumb === 'string' ? row.kept_thumb : null,
    created: flag(row?.created),
    recordedBytes: typeof row?.bytes === 'number' ? row.bytes : null,
    stillRecorded: flag(row?.still_recorded),
    items: count(row?.items),
    uploads: count(row?.uploads),
    uploadBytes: count(row?.upload_bytes),
    clubUploads: count(row?.club_uploads),
    clubUploadBytes: count(row?.club_upload_bytes),
    liveBytes: count(row?.live_bytes),
    clubLiveBytes: count(row?.club_live_bytes),
  };
}

/** The cap that refused a reservation, in the order the route answers them. */
/** 拒绝预留的上限，按接口回答的顺序排列。 */
export type StickerUploadRefusal = 'blocked' | 'unavailable' | 'full' | 'daily' | 'clubLimit' | 'memberStorage' | 'clubStorage';

/**
 * The first refusal that applies to a reservation that did not pass. 'unavailable' is also the answer when none of
 * the counts explains it, which a single transaction cannot produce.
 * 对未通过的预留，返回第一个适用的拒绝原因。没有任何计数能够解释时也回答 'unavailable'，而单个事务不会出现这种情况。
 */
export function uploadRefusal(probe: StickerReservation, sizes: Pick<StickerUpload, 'fileBytes' | 'requestBytes'>): StickerUploadRefusal {
  if (probe.blocked) return 'blocked';
  if (probe.state === 'deleting') return 'unavailable';
  if (!probe.mine && probe.items >= STICKERS_PER_MEMBER_MAX) return 'full';
  if (probe.uploads >= STICKER_UPLOADS_PER_DAY || probe.uploadBytes + sizes.requestBytes > STICKER_UPLOAD_BYTES_PER_DAY) return 'daily';
  if (probe.clubUploads >= STICKER_CLUB_UPLOADS_PER_DAY || probe.clubUploadBytes + sizes.requestBytes > STICKER_CLUB_UPLOAD_BYTES_PER_DAY) return 'clubLimit';
  // The storage R1 checked for a member who does not have the sticker: the still unless a row names it already, plus
  // the file when it is new or a pending row records another size. R6 did not run for a refused reserve, so the probe
  // shows what R1 saw.
  // R1 为还没有这个表情的成员检查过的存储空间：静态缩略图（除非已有记录指向它），文件是新的或 pending 记录的大小不同时再加上文件本身。
  // 被拒绝的预留没有执行 R6，因此探查到的正是 R1 看到的情况。
  const newFile = probe.state === null || (probe.state === 'pending' && probe.recordedBytes !== sizes.fileBytes);
  const storage = probe.mine ? 0 : (probe.stillRecorded ? 0 : sizes.requestBytes - sizes.fileBytes) + (newFile ? sizes.fileBytes : 0);
  if (storage > 0 && probe.liveBytes + storage > STICKER_LIVE_BYTES_PER_MEMBER) return 'memberStorage';
  if (storage > 0 && probe.clubLiveBytes + storage > STICKER_CLUB_LIVE_BYTES) return 'clubStorage';
  return 'unavailable';
}

/**
 * Takes a reserved upload whose R2 writes failed for any reason but a checksum mismatch back off the member's and the
 * club's day. The pending row, if the reserve wrote one, is left for the sweep, which deletes whatever the failed write
 * may have stored and takes its bytes off the running totals. So is the still the reserve recorded, with its bytes,
 * when the still's own put failed: that put may have stored it, so only the sweep or a block, which delete the key
 * before the row, may take it away; and a retry with the same still reuses the row, so R1 needs no room for it again.
 * When the original's put failed, the still was never put, and the route releases its row (discardStickerUpload).
 * 把因校验不符以外的原因导致 R2 写入失败的已预留上传从成员和全会当天的计数中退回。预留时若写了 pending 记录，就留给清理任务，
 * 由它删除失败的写入可能已经存下的内容，并把它的字节数从累计数中减去。静态缩略图自己的写入失败时，预留时记录的静态缩略图连同其字节数也一样保留：
 * 那次写入可能实际上已经存下了它，所以只有先删除键、再删除记录的清理任务或封禁才能移除它；用同一张静态缩略图重试时会沿用这条记录，
 * R1 因此不必再为它留出空间。原始文件的写入失败时，静态缩略图从未写入，接口会释放它的记录（discardStickerUpload）。
 */
export async function refundStickerUpload(db: D1Database, upload: Pick<StickerUpload, 'memberId' | 'requestBytes' | 'gate'>): Promise<void> {
  const refund = (scope: string) =>
    db
      .prepare('UPDATE sticker_daily SET uploads = MAX(0, uploads - 1), upload_bytes = MAX(0, upload_bytes - ?3) WHERE day = ?1 AND scope = ?2')
      .bind(upload.gate.day, scope, upload.requestBytes);
  await db.batch([refund(upload.memberId), refund('*')]);
}

/**
 * The pending row a request created (?1 the id, ?2 the member, ?3 the reserve's time, as R4 writes them), while no
 * other upload may have written a key it names: no other reserve passed over it (reserves = 1, which never goes down,
 * so a parallel upload that stored the original and then gave up its hold still counts; and since every reserve moves
 * the row's sweep at least an hour off and an upload's writes land within seconds of its reserve, no upload that may
 * still write can have reserved over an earlier row of the file that the sweep deleted, so every upload that may write
 * under this row is counted on it), and nothing has made use of it: not made ready, sent or blocked, in no collection,
 * and with no still but the one this request recorded (?4) while only this request holds it, so X1 takes back exactly
 * what this request charged. Otherwise the row stays for another upload's commit or the sweep, which deletes the
 * original under every type.
 * 某个请求新建的 pending 记录（?1 为 id，?2 为成员，?3 为预留的时间，即 R4 写入的值），且没有别的上传可能写入过它指向的任何键：
 * 此后没有别的预留在它之上通过（reserves = 1；它从不减少，因此存下了原始文件、随后又放弃持有的并行上传仍然计算在内；而每次预留都把记录的清理时间
 * 至少推迟一小时，上传的写入又都在其预留之后几秒内落地，仍可能写入的上传因此不可能是在同一文件之前那条已被清理任务删除的记录之上预留的，
 * 所以可能在这条记录之下写入的每次上传都已计入其中）；
 * 并且尚未被任何地方用到：没有变为 ready、没有发出、没有被封禁、不在任何表情列表中，除了本次请求记录的那张（?4）、且只有本次请求持有它之外，
 * 也没有别的静态缩略图，因此 X1 退回的恰好是本次请求计入的字节数。否则记录留给别的上传的提交或清理任务，由清理任务按每种类型删除原始文件。
 */
const OWN_PENDING = `id = ?1 AND state = 'pending' AND created_by = ?2 AND created_at = ?3 AND sent_at IS NULL AND blocked_at IS NULL AND reserves = 1
  AND NOT EXISTS (SELECT 1 FROM member_stickers WHERE sticker_id = ?1)
  AND NOT EXISTS (SELECT 1 FROM sticker_thumbs t WHERE t.sticker_id = ?1 AND (t.thumb IS NOT ?4 OR t.holders IS NOT 1))`;

/**
 * The still row (?1 the id, ?2 the still) whose last hold the releasing upload has, while no collection row names that
 * still (a grid that shows it means some upload stored it; one seek in member_stickers_sticker) and the file is not
 * blocked (the block took the still's bytes off already and deletes the row itself, after the key). Every lookup is by
 * a key, however many members have the file.
 * 正在释放的上传持有的是最后一个持有的静态缩略图记录（?1 为 id，?2 为静态缩略图），且没有任何表情列表记录指向这张静态缩略图
 * （某个表情格子显示它，说明已有上传存下了它；在 member_stickers_sticker 中查找一次），文件也没有被封禁（封禁已经减去了这张静态缩略图的字节数，
 * 并会在删除键之后自己删除这条记录）。无论有多少成员收藏了这个文件，每次查找都按键进行。
 */
const FREE_STILL = `sticker_id = ?1 AND thumb = ?2 AND holders = 1
  AND NOT EXISTS (SELECT 1 FROM member_stickers m WHERE m.sticker_id = ?1 AND m.thumb = ?2)
  AND EXISTS (SELECT 1 FROM sticker_objects o WHERE o.id = ?1 AND o.blocked_at IS NULL)`;

/**
 * After a failed write that stored nothing this request recorded, in one batch: deletes the pending row this request
 * created, with the still it recorded, when R2 refused the original for not hashing to the declared SHA-256 so nothing
 * of it was stored (`pending`); and releases this request's hold on the still row (`thumb`) when it never wrote that
 * still: R2 refused the original, which goes first, for any reason, or the still itself for its checksum. Bytes come
 * back off the running totals they are on. Otherwise every wrong hash, of the original or of the still, would leave a
 * row and a charge for a still that was never written, for as long as a stored file lives. A file anyone else created,
 * made ready or referenced, one another upload reserved over, and a row another upload still holds or has written its
 * still under, stay as they are. The day is the route's to settle.
 * 写入失败、本次请求记录的内容一样也没有存下之后，在一个批次中：如果 R2 因原始文件的字节与声明的 SHA-256 不符而拒绝写入、原始文件什么也没有存下
 * （`pending`），就删除本次请求新建的 pending 记录及其记录的静态缩略图；如果本次请求从未写入静态缩略图，即 R2 以任何原因拒绝了先写的原始文件，
 * 或因校验不符拒绝了静态缩略图本身，就释放本次请求对静态缩略图记录（`thumb`）的持有。字节数从它们所在的累计数中退回。
 * 否则原始文件或静态缩略图的每一次哈希不符，都会为一张从未写入的静态缩略图留下一条记录和一笔计费，只要已存储的文件还在就一直存在。
 * 别人新建的、已经变为 ready 或已被引用的文件，别的上传在其之上预留过的文件，以及仍被别的上传持有、或已有上传在其之下写入了静态缩略图的记录，
 * 都保持不变。当天的额度由接口处理。
 *
 * A still row is not matched by its creator: each upload that recorded or relied on it holds it (R6), and gives the
 * hold up exactly once, by writing the still (C2b, or readStickerLeftovers once the put may have stored it), which
 * keeps the row for good, or by this release. The row goes with the last hold, whoever recorded it, and its bytes come
 * off its creator's total, where R5 put them. So a parallel upload of the same still that relied on the row this
 * request recorded stays safe: while it holds the row, its key keeps a row; and when both give up without writing the
 * still, the row goes with the later of the two, so a client cannot leave rows behind by racing two wrong hashes. The
 * sweep never deletes a file with the row an upload in flight holds, since that upload's reserve moved the file's sweep
 * at least an hour off (R4). Only for an upload that outlived that hour, once the sweep deleted the file and another
 * upload recorded the still anew, can a release take a row it relies on: its commit then finds no row naming its still
 * and records it again with its bytes on its own total (C2a), and its failed write or commit finds no row and deletes
 * the still it wrote (deleteLeftovers in the route).
 * 静态缩略图记录不按创建者匹配：记录或依赖它的每次上传都持有它（R6），并且恰好放弃一次持有：要么写入静态缩略图（C2b，或在写入可能已存下它之后的
 * readStickerLeftovers），这会让记录永久保留；要么通过这里的释放。记录随最后一个持有一起删除，无论是谁记录的，其字节数从其创建者的累计数中减去，
 * 也就是 R5 计入的地方。因此依赖本次请求记录的那条记录、上传同一张静态缩略图的并行上传仍然是安全的：在它持有这条记录期间，它的键始终有记录；
 * 两者都没有写入静态缩略图就放弃时，记录随后放弃的那一个一起删除，客户端因此无法靠两个竞争的错误哈希留下记录。清理任务永远不会连同正在进行的上传
 * 所持有的记录一起删除文件，因为那次上传的预留已把文件的清理时间至少推迟了一小时（R4）。只有对超过这一小时仍未结束的上传，在清理任务删除了文件、
 * 另一次上传又重新记录了这张静态缩略图之后，释放才可能删除它所依赖的记录：那次上传的提交会发现没有记录指向它的静态缩略图，于是重新记录，
 * 并把字节数计入它自己的累计数（C2a）；它失败的写入或提交会发现没有记录，从而删除它写入的静态缩略图（接口中的 deleteLeftovers）。
 */
export async function discardStickerUpload(
  db: D1Database,
  upload: Pick<StickerUpload, 'memberId' | 'id' | 'nowMs'> & {
    /** The still this request recorded or relied on and never wrote; null when it holds none (the member had the sticker). */
    /** 本次请求记录或依赖了、却从未写入的静态缩略图；没有持有时为 null（成员已有这个表情）。 */
    thumb: string | null;
    /**
     * R2 refused the original for its checksum, so nothing of it was stored: the pending row this request created goes,
     * unless another request may have written a key it names (OWN_PENDING).
     * R2 因校验不符拒绝了原始文件、什么也没有存下：本次请求新建的 pending 记录也一并删除，除非别的请求可能写入过它指向的键（OWN_PENDING）。
     */
    pending: boolean;
  },
): Promise<void> {
  const now = new Date(upload.nowMs).toISOString();
  const statements: D1PreparedStatement[] = [];
  if (upload.pending) {
    statements.push(
      // X1. Its bytes and its still's off the member's and the club's running totals, before the row goes (OWN_PENDING
      // leaves no still but this request's own, which is on the same totals).
      // X1. 删除记录之前，先把它和它的静态缩略图的字节数从成员和全会的累计数中减去（OWN_PENDING 保证只剩本次请求自己的静态缩略图，它也计在同样的累计数上）。
      db
        .prepare(
          `UPDATE sticker_counts
           SET live_bytes = MAX(0, live_bytes - (SELECT bytes FROM sticker_objects WHERE id = ?1)
                                  - COALESCE((SELECT SUM(bytes) FROM sticker_thumbs WHERE sticker_id = ?1), 0))
           WHERE scope IN (?2, '*') AND EXISTS (SELECT 1 FROM sticker_objects WHERE ${OWN_PENDING})`,
        )
        .bind(upload.id, upload.memberId, now, upload.thumb),
      // X2. The row itself; its still's row cascades.
      // X2. 删除记录本身；其静态缩略图的记录随之级联删除。
      db.prepare(`DELETE FROM sticker_objects WHERE ${OWN_PENDING}`).bind(upload.id, upload.memberId, now, upload.thumb),
    );
  }
  if (upload.thumb !== null) {
    statements.push(
      // X3. The last hold: the still's bytes off its creator's and the club's running totals, before its row goes (none
      // is left once X2 deleted the file with it).
      // X3. 最后一个持有：删除静态缩略图的记录之前，先把它的字节数从其创建者和全会的累计数中减去（X2 已连同它一起删除文件时，就没有剩下的记录）。
      db
        .prepare(
          `UPDATE sticker_counts
           SET live_bytes = MAX(0, live_bytes - (SELECT bytes FROM sticker_thumbs WHERE sticker_id = ?1 AND thumb = ?2))
           WHERE scope IN ((SELECT created_by FROM sticker_thumbs WHERE sticker_id = ?1 AND thumb = ?2), '*')
             AND EXISTS (SELECT 1 FROM sticker_thumbs WHERE ${FREE_STILL})`,
        )
        .bind(upload.id, upload.thumb),
      // X4. The still's row itself.
      // X4. 删除静态缩略图的记录本身。
      db.prepare(`DELETE FROM sticker_thumbs WHERE ${FREE_STILL}`).bind(upload.id, upload.thumb),
      // X5. Otherwise this request's hold goes. A row with no other holder that a collection names or whose file is
      // blocked is kept for good (NULL): a grid shows it, or the block deletes it after the key.
      // X5. 否则释放本次请求的持有。没有别的持有者、但有表情列表指向它或文件已被封禁的记录永久保留（NULL）：有表情格子显示它，或者封禁会在删除键之后删除它。
      db
        .prepare('UPDATE sticker_thumbs SET holders = CASE WHEN holders > 1 THEN holders - 1 END WHERE sticker_id = ?1 AND thumb = ?2 AND holders > 0')
        .bind(upload.id, upload.thumb),
    );
  }
  if (statements.length > 0) await db.batch(statements);
}

/**
 * The commit batch, C0 to C7, once the original (and the still) are stored. R2 has just verified this upload's bytes
 * against the id's hash, so a pending row takes this upload's type, size, dimensions and animated flag (a row left by
 * an upload whose bytes R2 refused may carry others). A pending row that records another size was never stored by its
 * creator, so it becomes this member's: its recorded bytes leave its creator's and the club's totals and the verified
 * ones go on this member's and the club's, the storage R1 checked for this member. The file becomes ready and the
 * sweep looks again in a week, and the row is added or moved to the front. `thumb` is the still a new row shows: this
 * upload's, or the kept one when the member had the sticker at the reserve (that upload wrote no still). The still this
 * upload wrote was recorded by the reserve and this upload's hold keeps that row; when no row names it any more (only
 * for an upload that outlived the hour its reserve gave the file, R4: the sweep deleted the file with it, the file was
 * reserved anew, and the last upload to hold the row recorded anew may have released it), C2 records it again, kept
 * for good, and a row that is there is kept for good, so the key just written always has a row the sweep or a block
 * finds and no release takes.
 * 原始文件（以及静态缩略图）存好之后的提交批次 C0 到 C7。R2 刚刚按 id 对应的哈希校验过本次上传的字节，因此 pending 记录改用本次上传的类型、
 * 大小、尺寸和是否动图（字节被 R2 拒绝的上传留下的记录可能带着别的值）。记录的大小不同的 pending 记录从未被其创建者存下，因此归这位成员所有：
 * 记录中的字节数从其创建者和全会的累计数中减去，经过校验的字节数计入这位成员和全会的累计数，也就是 R1 为这位成员检查过的存储空间。
 * 文件变为 ready，清理任务一周后再检查；然后添加这一行，或把它移到最前。`thumb` 是新记录显示的静态图：本次上传的，或者在预留时成员已有这个表情的情况下
 * 保留下来的那张（那次上传没有写入静态缩略图）。本次上传写入的静态缩略图已由预留批次记录，本次上传的持有也让这条记录保留；如果已没有任何记录指向它
 * （只有超过预留给文件的那一小时（R4）仍未结束的上传才会遇到：清理任务连同它一起删除了文件、文件之后又被重新预留，最后一个持有重新记录的那条记录的
 * 上传还可能已经释放了它），C2 重新记录它并永久保留，已有的记录也永久保留，刚写入的键因此总有一条清理任务或封禁能找到、任何释放都不会删除的记录。
 */
export async function commitStickerUpload(
  db: D1Database,
  input: {
    memberId: string;
    id: string;
    thumb: string | null;
    /** Bytes of the still this upload wrote under `thumb`; null when it wrote none (the member had the sticker). */
    /** 本次上传以 `thumb` 写入的静态缩略图的字节数；没有写入时为 null（成员已有这个表情）。 */
    stillBytes: number | null;
    nowMs: number;
    countToken: string;
  } & Pick<StickerUpload, 'type' | 'width' | 'height' | 'animated' | 'fileBytes'>,
): Promise<StickerAddResult> {
  const row: AddRow = { memberId: input.memberId, id: input.id, thumb: input.thumb, nowMs: input.nowMs, countToken: input.countToken };
  const still = input.thumb !== null && input.stillBytes !== null ? { thumb: input.thumb, bytes: input.stillBytes } : null;
  const statements = [
    // C0a. A pending, unblocked row that records another size (a block already took its bytes off): its recorded bytes
    // leave its creator's and the club's totals.
    // C0a. 记录的大小不同、仍为 pending 且未被封禁的记录（封禁已经减去了它的字节数）：记录中的字节数从其创建者和全会的累计数中减去。
    db
      .prepare(
        `UPDATE sticker_counts SET live_bytes = MAX(0, live_bytes - (SELECT bytes FROM sticker_objects WHERE id = ?1))
         WHERE scope IN ((SELECT created_by FROM sticker_objects WHERE id = ?1), '*')
           AND EXISTS (SELECT 1 FROM sticker_objects WHERE id = ?1 AND state = 'pending' AND blocked_at IS NULL AND bytes <> ?2)`,
      )
      .bind(input.id, input.fileBytes),
    // C0b. The same row: the bytes R2 just verified go on this member's and the club's totals.
    // C0b. 同一条记录：R2 刚刚校验过的字节数计入这位成员和全会的累计数。
    db
      .prepare(
        `INSERT INTO sticker_counts (scope, live_bytes)
         SELECT value, ?2 FROM json_each(json_array(?3, '*'))
         WHERE EXISTS (SELECT 1 FROM sticker_objects WHERE id = ?1 AND state = 'pending' AND blocked_at IS NULL AND bytes <> ?2)
         ON CONFLICT (scope) DO UPDATE SET live_bytes = live_bytes + excluded.live_bytes`,
      )
      .bind(input.id, input.fileBytes, input.memberId),
    // C1. The file is stored: usable from now on, with the verified type (so the row names the key just written, which
    // a block then deletes), size, dimensions and flag, and this member as its creator when C0 moved it; the sweep
    // looks again in a week. SET reads the row as it was, so the CASE sees the recorded size.
    // C1. 文件已存好：从现在起可用，并使用经过校验的类型（记录因此指向刚写入的键，封禁时删除的也是它）、大小、尺寸和动图标记，
    // C0 转移了它时创建者改为这位成员；清理任务一周后再检查。SET 读取的是更新前的记录，因此 CASE 看到的是记录中原来的大小。
    db
      .prepare(
        `UPDATE sticker_objects
         SET state = 'ready', sweep_at = ?2, type = ?3, width = ?4, height = ?5, bytes = ?6, animated = ?7,
             created_by = CASE WHEN bytes <> ?6 AND blocked_at IS NULL THEN ?8 ELSE created_by END
         WHERE id = ?1 AND state = 'pending'`,
      )
      .bind(
        input.id,
        new Date(input.nowMs + STICKER_UNSENT_TTL_MS).toISOString(),
        input.type,
        input.width,
        input.height,
        input.fileBytes,
        input.animated ? 1 : 0,
        input.memberId,
      ),
    ...(still
      ? [
          // C2a. The still's bytes, on the member's and the club's running totals, when C2b is about to record it again:
          // the file is usable and no row names the still. Checked before the insert, as R5 does, so it is charged once.
          // C2a. C2b 即将重新记录静态缩略图时（文件可用，且没有任何记录指向它），把它的字节数计入成员和全会的累计数。与 R5 一样在插入之前检查，因此只计入一次。
          db
            .prepare(
              `INSERT INTO sticker_counts (scope, live_bytes)
               SELECT value, ?3 FROM json_each(json_array(?4, '*'))
               WHERE NOT EXISTS (SELECT 1 FROM sticker_thumbs WHERE sticker_id = ?1 AND thumb = ?2)
                 AND EXISTS (SELECT 1 FROM sticker_objects WHERE id = ?1 AND state = 'ready' AND blocked_at IS NULL)
               ON CONFLICT (scope) DO UPDATE SET live_bytes = live_bytes + excluded.live_bytes`,
            )
            .bind(input.id, still.thumb, still.bytes, input.memberId),
          // C2b. The still again, while the file is usable, kept for good (holders NULL) since its key is written now; a
          // still already recorded keeps its creator, time and bytes and is kept for good, so no release takes the row
          // this key relies on.
          // C2b. 文件可用时重新记录静态缩略图，并永久保留（holders 为 NULL），因为它的键现在已经写入；已有记录的静态缩略图保留其创建者、
          // 时间和字节数，并永久保留，因此任何释放都不会删除这个键所依赖的记录。
          db
            .prepare(
              `INSERT INTO sticker_thumbs (sticker_id, thumb, created_at, bytes, created_by, holders)
               SELECT ?1, ?2, ?3, ?4, ?5, NULL
               WHERE EXISTS (SELECT 1 FROM sticker_objects WHERE id = ?1 AND state = 'ready' AND blocked_at IS NULL)
               ON CONFLICT (sticker_id, thumb) DO UPDATE SET holders = NULL`,
            )
            .bind(input.id, still.thumb, new Date(input.nowMs).toISOString(), still.bytes, input.memberId),
        ]
      : []),
    ...addRowStatements(db, row, null),
    addOutcomeStatement(db, row, null),
  ];
  const results = await db.batch(statements);
  return addResult(results[results.length - 1]?.results[0] as AddOutcomeRow | undefined);
}

/** What an upload whose write or commit failed after the reserve finds of the file and of its still. */
/** 预留之后写入或提交失败的上传所看到的文件及其静态缩略图的情况。 */
export interface StickerLeftovers {
  /**
   * The file has been blocked, claimed by the sweep or deleted. Nothing can reference such a file, and neither a block
   * nor the sweep deletes a key that lands after its own delete, so the upload deletes what it wrote. While the upload
   * is in flight only a block can do this: its reserve moved the file's sweep at least an hour off (R4), so a file
   * claimed or deleted means the upload outlived that hour. A pending or ready row keeps it: the sweep deletes a pending
   * row's file under every type (and the reserve wrote the row or counted the upload on it, so no other request's
   * discard takes it), and a ready file's original was only written again with the same bytes.
   * 文件已被封禁、被清理任务认领或已被删除。这样的文件不可能被任何地方引用，而封禁和清理任务都不会删除在它们自己的删除之后才写入的键，
   * 因此由这次上传删除它写入的内容。上传进行期间只有封禁会造成这种情况：它的预留已把文件的清理时间至少推迟了一小时（R4），
   * 文件被认领或已被删除说明这次上传超过了这一小时仍未结束。pending 或 ready 的记录保留它：清理任务会按每种类型删除 pending 记录的文件
   * （预留时这次上传写入了这条记录或已计入其中，因此别的请求的丢弃都不会删除它），已就绪文件的原始文件只是以相同的字节重新写入了一次。
   */
  gone: boolean;
  /**
   * Some row still names the upload's still. The upload holds that row from its reserve until it writes the still or
   * gives up, so none does only once the file is blocked (gone covers it) or, for an upload that outlived the hour its
   * reserve gave the file, once the sweep deleted the file with it and the file was reserved anew, or the last upload to
   * hold the row recorded anew since released it: nothing would ever delete that key, so the upload deletes it.
   * 仍有记录指向这次上传的静态缩略图。这次上传从预留起一直持有那条记录，直到写入静态缩略图或放弃，因此只有在文件被封禁（由 gone 处理）时，
   * 或者对于超过预留给文件的那一小时仍未结束的上传，在清理任务连同它一起删除了文件、文件之后又被重新预留，或者此后最后一个持有重新记录的那条记录的上传
   * 又释放了它时，才没有任何记录指向它：再也没有别的途径会删除这个键，因此由这次上传删除它。
   */
  stillRecorded: boolean;
}

/**
 * The file of a failed upload and its still (`thumb`, null when it wrote none), in one primary-key read each. In the
 * same batch, first, a still row found is kept for good (holders NULL): the upload keeps the still it may have written
 * under it, so no release may take the row afterwards. A pending row needs nothing more: the reserve wrote it or
 * counted this upload on it (R4), and moved its sweep at least an hour off, so the row found is that same row, which no
 * other request's discard takes. Only an upload that outlived that hour, which takes an R2 or D1 call hung for it, can
 * find a newer row it was never counted on; such an upload is outside what the hour guards in any case (its commit
 * could make such a row ready), so nothing is written for it here.
 * 失败的上传的文件及其静态缩略图（`thumb`，没有写入时为 null），各用一次主键查找读取。在同一个批次中先把找到的静态缩略图记录设为永久保留
 * （holders 为 NULL）：上传会保留它可能已在其之下写入的静态缩略图，因此之后任何释放都不能删除这条记录。pending 记录不需要再做什么：
 * 预留时写入了它或把这次上传计入其中（R4），并把它的清理时间至少推迟了一小时，因此找到的正是那条记录，别的请求的丢弃都不会删除它。
 * 只有超过这一小时仍未结束的上传（需要某个 R2 或 D1 调用挂起这么久）才可能找到一条从未计入它的更新的记录；这样的上传无论如何都不在这一小时
 * 所保护的范围之内（它的提交可能把这样的记录变为 ready），因此这里不为它写入任何东西。
 */
export async function readStickerLeftovers(db: D1Database, id: string, thumb: string | null): Promise<StickerLeftovers> {
  const read = db
    .prepare(
      `SELECT EXISTS (SELECT 1 FROM sticker_objects WHERE id = ?1 AND blocked_at IS NULL AND state <> 'deleting') AS kept,
              EXISTS (SELECT 1 FROM sticker_thumbs WHERE sticker_id = ?1 AND thumb = ?2) AS recorded`,
    )
    .bind(id, thumb);
  const mark = db.prepare('UPDATE sticker_thumbs SET holders = NULL WHERE sticker_id = ?1 AND thumb = ?2').bind(id, thumb);
  const results = await db.batch(thumb === null ? [read] : [mark, read]);
  const row = results[results.length - 1]?.results[0] as { kept: number; recorded: number } | undefined;
  // The statement always answers one row; without one, everything stays.
  // 这条语句总是返回一行；没有返回时全部保留。
  if (!row) return { gone: false, stillRecorded: true };
  return { gone: !flag(row.kept), stillRecorded: flag(row.recorded) };
}

/* POST /stickers/block */
/* 封禁表情 */

export interface StickerBlockRead {
  type: StickerType;
  /** Every still recorded for the file. */
  /** 这个文件记录过的所有静态缩略图。 */
  thumbs: string[];
}

/**
 * Step 1 of a block: marks the file blocked (the first time only, its bytes and its stills' leave their creators' and
 * the club's totals), takes it out of every collection with their totals and versions, and reads its type and every
 * still so the caller can delete the objects. The row stays, so the same bytes can never be uploaded or added again,
 * and no still can be recorded for it any more. Null for an unknown id. Repeating it is safe.
 * 封禁的第一步：把文件标记为已封禁（只在第一次封禁时，把它和它的静态缩略图的字节数从各自创建者和全会的累计数中减去），把它从每个表情列表中移除并更新各自的总数和版本号，
 * 再读出它的类型和所有静态缩略图，供调用方删除对象。记录保留，相同的字节因此永远无法再次上传或添加，也不会再为它记录任何静态缩略图。
 * id 不存在时为 null。重复执行是安全的。
 */
export async function blockSticker(db: D1Database, id: string, nowIso: string): Promise<StickerBlockRead | null> {
  const results = await db.batch([
    // B1. Block it; a repeat keeps the first time.
    // B1. 封禁；重复封禁保留第一次的时间。
    db.prepare('UPDATE sticker_objects SET blocked_at = COALESCE(blocked_at, ?2) WHERE id = ?1').bind(id, nowIso),
    // B2. The first block takes the bytes of the file and of every still off their creators' and the club's running
    // totals, summed per scope (one member may have created both), before step 3 deletes the stills' rows.
    // B2. 第一次封禁时，在第三步删除静态缩略图的记录之前，把文件和每张静态缩略图的字节数按范围求和（同一位成员可能两者都创建过），
    // 从各自创建者和全会的累计数中减去。
    db
      .prepare(
        `WITH gone (scope, bytes) AS (
           SELECT created_by, bytes FROM sticker_objects WHERE id = ?1
           UNION ALL
           SELECT created_by, bytes FROM sticker_thumbs WHERE sticker_id = ?1)
         UPDATE sticker_counts SET live_bytes = MAX(0, live_bytes - totals.bytes)
         FROM (SELECT scope, SUM(bytes) AS bytes FROM gone GROUP BY scope
               UNION ALL
               SELECT '*', SUM(bytes) FROM gone) AS totals
         WHERE sticker_counts.scope = totals.scope AND totals.bytes > 0
           AND EXISTS (SELECT 1 FROM sticker_objects WHERE id = ?1 AND blocked_at = ?2)`,
      )
      .bind(id, nowIso),
    // B3. One sticker fewer and a new version for every member whose collection has it.
    // B3. 每位列表中有它的成员：总数减一，并得到新的版本号。
    db
      .prepare(
        `UPDATE sticker_counts SET items = MAX(0, items - 1), version = version + 1
         WHERE scope IN (SELECT member_id FROM member_stickers WHERE sticker_id = ?1)`,
      )
      .bind(id),
    // B4. Out of every collection.
    // B4. 从每个表情列表中移除。
    db.prepare('DELETE FROM member_stickers WHERE sticker_id = ?1').bind(id),
    // B5. The file's type and every still, for the R2 delete.
    // B5. 文件的类型和所有静态缩略图，供 R2 删除使用。
    db
      .prepare('SELECT type, (SELECT json_group_array(thumb) FROM sticker_thumbs WHERE sticker_id = ?1) AS thumbs FROM sticker_objects WHERE id = ?1')
      .bind(id),
  ]);
  const row = results[results.length - 1]?.results[0] as { type: StickerType; thumbs: string | null } | undefined;
  if (!row) return null;
  return { type: row.type, thumbs: parseThumbs(row.thumbs) };
}

/**
 * Every R2 key a file can have, for the sweep and a block: the original under each type, then every recorded still.
 * A key is only ever written for the type its own bytes sniff as, but a pending row may record another type (one
 * written for bytes R2 refused), so naming all four never leaves the original an upload wrote over such a row. A key
 * that was never written costs nothing to delete.
 * 一个文件可能有的所有 R2 键，供清理任务和封禁使用：每种类型下的原始文件，然后是每张已记录的静态缩略图。键只会按其字节本身嗅探出的类型写入，
 * 但 pending 记录可能记着别的类型（为被 R2 拒绝的字节写下的），因此列出全部四种，就不会漏掉在这种记录之上上传时写入的原始文件。
 * 删除一个从未写入的键没有任何代价。
 */
export function stickerFileKeys(id: string, thumbs: readonly string[]): string[] {
  return [...STICKER_TYPES.map((type) => stickerObjectKey(id, type)), ...thumbs.filter(isStickerThumbToken).map((thumb) => stickerThumbKey(id, thumb))];
}

/** A json_group_array of stills, read defensively. */
/** json_group_array 得到的静态缩略图列表，按防御方式读取。 */
export function parseThumbs(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((thumb): thumb is string => typeof thumb === 'string') : [];
  } catch {
    return [];
  }
}

/** Step 3 of a block, once R2 deleted the objects: the stills' rows go too. */
/** 封禁的第三步，在 R2 删除对象之后：静态缩略图的记录也一并删除。 */
export async function forgetStickerThumbs(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM sticker_thumbs WHERE sticker_id = ?1').bind(id).run();
}
