-- Custom stickers. One row per sticker file. The id is a keyed hash of the file's SHA-256, so the same bytes are
-- stored once (R2 sticker/<id>.<type>) and shared by everyone who adds them. state: pending while an upload is
-- writing the file, ready once it is stored, deleting while the sweep removes an unused file. sent_at is set the first
-- time a room accepts it; sweep_at is when the sweep next looks at a file nobody has sent. Every upload's reserve moves
-- sweep_at to at least an hour (STICKER_PENDING_TTL_MS) after it, NULL staying NULL (never swept), so the sweep never
-- takes a row an upload in flight reserved over: all an upload does after its reserve takes seconds. blocked_at marks a
-- file a system administrator blocked: its objects are deleted and the row stays, so the same bytes cannot come back.
-- reserves counts the uploads that may have written the original under a pending row: the one that wrote the row and
-- each one whose reserve passed over it while it was pending. It only ever goes up. The upload that wrote the row may
-- delete it only while it is 1; otherwise the row stays for a commit or the sweep. Since no row an upload in flight
-- reserved over is swept, every upload that may write a key the row names is counted on it.
-- 自定义表情。每个表情文件一行。id 是文件 SHA-256 的带密钥哈希，因此相同的字节只存一份（R2 sticker/<id>.<type>），由所有添加它的人共用。
-- state：上传正在写入文件时为 pending，存好后为 ready，清理任务删除无用文件期间为 deleting。sent_at 在房间第一次接受它时写入；
-- sweep_at 是清理任务下次检查这个从未发出的文件的时间。每次上传的预留都把 sweep_at 至少推迟到预留之后一小时（STICKER_PENDING_TTL_MS），
-- 为 NULL 的仍为 NULL（永远不被清理），因此清理任务永远不会删除正在进行的上传在其之上预留的记录：上传在预留之后做的一切只需几秒钟。
-- blocked_at 表示系统管理员已封禁：对象被删除，记录保留，相同的字节因此无法再次上传。
-- reserves 是可能在 pending 记录之下写入了原始文件的上传的数量：写入这条记录的那次上传，以及记录为 pending 期间预留通过的每次上传。
-- 它只增不减。写入这条记录的上传只有在它为 1 时才可以删除这条记录；否则记录留给提交或清理任务。由于正在进行的上传在其之上预留的记录不会被清理，
-- 可能写入这条记录所指向的键的每次上传都已计入其中。
CREATE TABLE sticker_objects (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('gif', 'png', 'webp', 'jpeg')),
  width INTEGER NOT NULL CHECK (width > 0),
  height INTEGER NOT NULL CHECK (height > 0),
  bytes INTEGER NOT NULL CHECK (bytes > 0),
  animated INTEGER NOT NULL DEFAULT 0 CHECK (animated IN (0, 1)),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'ready', 'deleting')),
  created_by TEXT REFERENCES members (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  sweep_at TEXT,
  blocked_at TEXT,
  reserves INTEGER NOT NULL DEFAULT 1 CHECK (reserves > 0)
);

-- Files nobody has sent, by when the sweep looks at them next. Sent and blocked files leave the index.
-- 从未被发出的文件，按清理任务下次检查的时间排列。已发出或已封禁的文件不在这个索引里。
CREATE INDEX sticker_objects_sweep ON sticker_objects (sweep_at) WHERE sent_at IS NULL AND blocked_at IS NULL;

-- Keeps ON DELETE SET NULL cheap when a member is deleted.
-- 删除成员时，让 ON DELETE SET NULL 不必扫描整张表。
CREATE INDEX sticker_objects_creator ON sticker_objects (created_by);

-- Every still an upload recorded for a file (R2 sticker/<id>-t-<thumb>), so the sweep and a block can delete them all.
-- An upload records its still before writing it, so R2 never holds a still that no row names. bytes is on the
-- running totals of created_by and of the club while the row exists. created_by has no foreign key: it only names the
-- total the bytes come back off. holders counts the uploads that recorded or relied on the row and have neither
-- written its still nor given up; it is NULL once one has written it or may have (a commit, or a write or commit that
-- failed after the put), and the row is then kept until the sweep or a block deletes the key first. Each upload that
-- gives up without writing the still releases its hold, and the last one deletes the row and takes its bytes back off.
-- A row written without holders is kept.
-- 上传为每个文件记录的所有静态缩略图（R2 sticker/<id>-t-<thumb>），清理任务和封禁据此把它们全部删除。上传在写入静态缩略图之前先记录它，
-- 因此 R2 里不会有任何记录都不指向的静态缩略图。记录存在期间，bytes 计入 created_by 和全会的累计数。created_by 不设外键：
-- 它只用来说明这些字节要从谁的累计数中减去。holders 是记录或依赖这条记录、既没有写入其静态缩略图也没有放弃的上传的数量；
-- 一旦有上传写入了它或可能写入了它（提交，或写入之后失败的写入或提交），holders 就变为 NULL，此后这条记录一直保留，直到清理任务或封禁先删除键。
-- 每个没有写入静态缩略图就放弃的上传释放它的持有，最后一个释放者删除这条记录并退回其字节数。写入时没有给出 holders 的记录一直保留。
CREATE TABLE sticker_thumbs (
  sticker_id TEXT NOT NULL REFERENCES sticker_objects (id) ON DELETE CASCADE,
  thumb TEXT NOT NULL,
  created_at TEXT NOT NULL,
  bytes INTEGER NOT NULL DEFAULT 0 CHECK (bytes >= 0),
  created_by TEXT,
  holders INTEGER CHECK (holders > 0),
  PRIMARY KEY (sticker_id, thumb)
);

-- Each member's collection (我的表情). thumb is the still this member's grid shows. position orders it, largest first:
-- the add or move-to-front time in milliseconds times 1000, plus a rank below 1000 when several move at once, so no
-- write needs to read the current largest value first.
-- 每位成员的表情列表（我的表情）。thumb 是这位成员的表情格子显示的静态图。position 决定顺序，大的在前：添加或移到最前时的毫秒时间乘以
-- 1000，多个一起移动时再加上小于 1000 的名次，因此任何写入都不必先读取当前的最大值。
CREATE TABLE member_stickers (
  member_id TEXT NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  sticker_id TEXT NOT NULL REFERENCES sticker_objects (id),
  thumb TEXT,
  position INTEGER NOT NULL,
  added_at TEXT NOT NULL,
  PRIMARY KEY (member_id, sticker_id)
);

-- A member's collection in display order, for the list.
-- 按显示顺序排列的成员表情列表，供列表接口使用。
CREATE INDEX member_stickers_order ON member_stickers (member_id, position DESC);

-- Who has a file in their collection: the sweep, a block, and the foreign key check when a file row is deleted. With
-- the still each grid shows, so whether any collection names one still of a file is a single seek.
-- 谁的表情列表里有某个文件：清理任务、封禁，以及删除文件记录时的外键检查都要用到。索引中带上每个表情格子显示的静态图，
-- 因此判断是否有任何表情列表指向某个文件的某张静态缩略图只需一次查找。
CREATE INDEX member_stickers_sticker ON member_stickers (sticker_id, thumb);

-- Running totals, one row per member and one with scope '*' for the whole club. items is the collection size,
-- live_bytes the bytes of files and stills created that still exist, version goes up with every change to the
-- collection, and token marks the last add that counted in, for the statement after it in the same batch.
-- 累计数，每位成员一行，另有 scope 为 '*' 的一行代表全会。items 是表情列表的数量，live_bytes 是本人创建且仍然存在的文件和静态缩略图的字节数，
-- version 在表情列表每次变化时加一，token 标记最近一次被计入的添加，供同一批次中后面的语句使用。
CREATE TABLE sticker_counts (
  scope TEXT PRIMARY KEY,
  items INTEGER NOT NULL DEFAULT 0,
  live_bytes INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 0,
  token TEXT
);

-- Daily counts per club-local day (America/Toronto, YYYY-MM-DD), one row per member and one with scope '*' for the
-- whole club. token marks the request whose gate passed last, for the statements after it in the same batch. Rows
-- older than two days are deleted by the sweep.
-- 按社团所在地日期（America/Toronto，YYYY-MM-DD）的每日计数，每位成员一行，另有 scope 为 '*' 的一行代表全会。token 标记最近一次
-- 通过闸门的请求，供同一批次中后面的语句使用。两天前的记录由清理任务删除。
CREATE TABLE sticker_daily (
  day TEXT NOT NULL,
  scope TEXT NOT NULL,
  uploads INTEGER NOT NULL DEFAULT 0,
  upload_bytes INTEGER NOT NULL DEFAULT 0,
  edits INTEGER NOT NULL DEFAULT 0,
  lists INTEGER NOT NULL DEFAULT 0,
  token TEXT,
  PRIMARY KEY (day, scope)
);
