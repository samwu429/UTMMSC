# apps/api

Cloudflare Worker that serves the UTMMSC API and hosts the `ChatRoom` Durable Object.

## Layout

```
src/
  index.ts              Worker entry; exports the fetch and cron handlers, ChatRoom and PushRelay
  env.ts                Bindings and variables
  http/
    app.ts              Route composition, CORS, error handling
    context.ts          Hono typings
    errors.ts           ApiHttpError and error envelope
    validation.ts       Body and field helpers
    middleware/         cors, session, rate-limit
    routes/
      auth/             code, register, login, reset, apply, me, logout, password
      members/          directory with keyset pagination, profile
      chat/             overview, direct, room tickets, socket upgrade, images, media,
                        room info, members, prefs, read, clear
      channels/         create, update, membership (channels.manage)
      files/            list, upload, download, delete
      home/             daily card
      admin/            applications, roles, status, events (with notice plans), announcements
      notifications/    VAPID key, push devices, notification switches, test push
      stickers/         my stickers (我的表情): list, upload, add, front, remove, block
    rooms.ts            Typed helpers over the ChatRoom stub (revoke, summaries, read, clear, join notices)
  realtime/
    rooms/
      chat-room.ts      Durable Object: hibernating WebSockets, SQLite history, read cursors, mutes,
                        history floor, catch-up, hides, clears, join notices
      room-schema.ts    Versioned room schema and the room revision counter
      history.ts        Pure floor, unread, paging, quote and mention rules
  domain/
    crypto/             base64url, HMAC sign/verify
    identity/           password hashing, session tokens, room tickets, verification codes
    authorization/      channel read/post rules, audience role filter
    messaging/          preview text, list previews, history floor policy (visibility.ts)
    notifications/      push copy, message recipients, event notice plans
  infrastructure/
    d1/                 one module per table; chat also uses channel-joins, chat-prefs, room-members
    r2/                 object keys and put/get/delete
    email/              Brevo client and Chinese templates
    weather/            Open-Meteo
    push/               Web Push and FCM delivery, relay object, chat and event notices
migrations/             D1 schema
```

## Chat history floor

Channels follow WeChat: a member who joins after the policy started only sees messages from their join on.
频道规则与微信一致：在策略生效之后加入的成员，只能看到加入之后的消息。

- `routes/chat` computes `RoomAccess {joinedAt, floorApplies}` with `domain/messaging/visibility.ts` and signs it into the room ticket.
- `routes/chat` 用 `domain/messaging/visibility.ts` 计算 `RoomAccess {joinedAt, floorApplies}`，并签进房间票据。
- Join time: `channel_memberships.joined_at` for custom channels; `channel_joins.joined_at` for audience channels, else the later of `members.created_at` and `channels.created_at`.
- 加入时间：指定成员频道取 `channel_memberships.joined_at`；受众频道取 `channel_joins.joined_at`，没有时取 `members.created_at` 与 `channels.created_at` 中较晚的一个。
- A join earlier than `channels.history_floor_since` is grandfathered (no floor). Saving a member list keeps the join time of members who stay; removing and re-adding someone gives a new floor.
- 加入时间早于 `channels.history_floor_since` 的成员保留完整历史（没有下限）。保存成员名单时，留下的成员保持原加入时间；移除后再加入的成员会得到新的下限。
- `history_visibility = 'all'` (新成员可查看历史消息) lifts the floor but keeps the unread baseline at the join. `channels.manage` viewers and direct messages are never floored.
- `history_visibility = 'all'`（新成员可查看历史消息）取消下限，但未读仍从加入处开始计算。拥有 `channels.manage` 的观看者和私聊永远不受下限限制。
- The room keeps each socket's floor in its attachment, so it survives hibernation, and applies it to history pages, catch-up, quotes, unread and mention counts, and list previews.
- 房间把每个连接的下限保存在附件中，休眠后仍然有效，并在历史分页、补齐、引用、未读和 @ 计数以及列表预览中执行。
- If migration 0013 has not run, missing columns and tables fail open: no floor and empty prefs.
- 迁移 0013 尚未执行时，缺失的列和表按不设下限处理：没有下限，列表设置为空。

## Room sync

- Every stored-row change and every hide takes the next room revision (`meta.rev` in the room's SQLite). A reconnect sends `{history, afterId, oldestId, sinceRev}` and gets new rows plus `changed` and `hiddenIds`, each capped at 50; past that, `changedOverflow` tells the client to reload the latest page.
- 已存行的每次变更和每次隐藏都会取下一个房间版本号（房间 SQLite 中的 `meta.rev`）。重连时发送 `{history, afterId, oldestId, sinceRev}`，返回新消息以及 `changed` 和 `hiddenIds`，每项最多 50 条；超过时 `changedOverflow` 让客户端重新加载最新一页。
- `clientId` is an idempotency key on `(author_id, client_id)`. A repeated send is answered from the stored row to the sender only, before mute and rate limits.
- `clientId` 是 `(author_id, client_id)` 上的幂等键。重复发送会在禁言和限流之前，直接用已存的行只回复给发送者。
- Quotes are built at read time and per socket, so a recalled, deleted, missing or below-floor target only shows its state.
- 引用在读取时按连接生成，被撤回、删除、不存在或在下限以下的消息只显示其状态。
- `chat_prefs` holds pin, mute, mark-as-unread and hide per member and room; the overview returns them with each row.
- `chat_prefs` 按成员和房间保存置顶、免打扰、标为未读和隐藏；概览在每一行中返回它们。
- The overview makes one room RPC per conversation with activity, so clients poll it only while the chat tab is open (every 30 seconds, paused while hidden) and on focus or return.
- 概览对每个有消息的会话发起一次房间 RPC，因此客户端只在聊天页打开时轮询（每 30 秒，页面隐藏时暂停），以及在获得焦点或返回时刷新。

## Notifications

Pushes go to browsers and home-screen web apps through Web Push (VAPID) and to the Android app through FCM HTTP v1.
推送通过 Web Push（VAPID）发往浏览器和主屏幕网页应用，通过 FCM HTTP v1 发往安卓应用。

- A device row (`push_devices`) belongs to the member who registered it last and to that sign-in. Only active members with a live session receive pushes, so signing out, a password reset or a revoked session stops them. Clients re-register after every sign-in.
- 设备记录（`push_devices`）属于最后登记它的成员及其那次登录。只有登录仍然有效的在用成员才会收到推送，因此退出登录、重设密码或撤销会话都会停止推送。客户端每次登录后都要重新登记。
- New chat messages go to everyone who can read the room, minus the author and anyone looking at the room: a socket counts only while its page is on screen, which clients report with a `visibility` frame. 消息免打扰 chats are skipped unless the member is @-mentioned or @所有人 is used. The room throttles per member and room (`MESSAGE_PUSH_INTERVAL_MS`) and calls `notifyChatMessage` from `infrastructure/push/chat.ts`.
- 新消息推送给所有能阅读该房间的人，但不包括发送人和正在看该房间的人：只有页面显示在屏幕上的连接才算在看，客户端通过 `visibility` 帧报告。设置了消息免打扰的聊天只有被 @ 或使用 @所有人 时才推送。房间按成员和房间限频（`MESSAGE_PUSH_INTERVAL_MS`），并调用 `infrastructure/push/chat.ts` 中的 `notifyChatMessage`。
- The room remembers the last message it pushed to each member (`push_sent`). When that message is recalled or removed, `notifyChatRetraction` sends a `recall` push under the same tag (room id) to those members who see previews, after the original push has finished, so the text leaves their shade and a copy still queued at the push service is overwritten (Web Push `Topic`, FCM `collapse_key`).
- 房间记录最近推送给每位成员的消息（`push_sent`）。这条消息被撤回或删除时，`notifyChatRetraction` 会在原推送发完后，以相同 tag（房间 id）向这些开启了显示内容的成员发送一条 `recall` 推送，原文因此离开通知栏，推送服务中仍在排队的副本也会被覆盖（Web Push 的 `Topic`、FCM 的 `collapse_key`）。
- Event notices are rows in `event_notifications`: the publish notice is sent right after the event is created, the morning notice at 09:00 Toronto time (earlier for morning events, see `morningOf`), plus up to five custom times, up to a day after the start. The cron (`*/5 * * * *`) claims due rows, sends them to every active member with event notices on, and records how many were reached. Publish and morning notices still pending an hour after the start are cancelled; a custom notice only when it is also over an hour late (`isStaleNotice`).
- 活动通知是 `event_notifications` 中的行：发布通知在活动创建后立即发送，当天早上提醒在多伦多时间 09:00 发送（早上的活动会提前，见 `morningOf`），另有最多五个自定义时间，最晚到活动开始后一天。定时任务（`*/5 * * * *`）领取到期的行，发送给所有开启了活动通知的在用成员，并记录收到的人数。活动开始一小时后仍未发出的发布通知和当天早上提醒会被取消；自定义通知只有在本身也晚了超过一小时时才取消（`isStaleNotice`）。
- Large fan-outs are split through the `PushRelay` Durable Object, 40 pushes per call, because one invocation on the free plan may make only 50 outbound requests.
- 大批量推送经由 `PushRelay` Durable Object 拆分，每次调用 40 条，因为免费套餐的一次调用最多只能发出 50 个外发请求。
- Devices are removed when the push service says they are gone, or after five consecutive refusals. Outages and our own credential errors do not count against a device. A Web Push endpoint must be on a known push service (Google, Mozilla, Apple, Microsoft) on the default port, and redirects are never followed, so the Worker cannot be pointed at another address.
- 推送服务表示设备已失效时，或连续五次被拒绝后，设备会被删除。推送服务故障和我方凭据错误不计入设备的失败次数。Web Push 的 endpoint 必须属于已知的推送服务（Google、Mozilla、Apple、Microsoft）且使用默认端口，重定向一律不跟随，因此无法让 Worker 去请求其他地址。

Setup / 配置:

```bash
node scripts/vapid-keys.mjs                  # prints the public key -> VAPID_PUBLIC_KEY in wrangler.jsonc; writes .vapid-private.json (gitignored)
npx wrangler secret put VAPID_PRIVATE_KEY < .vapid-private.json
npx wrangler secret put FCM_SERVICE_ACCOUNT < service-account.json  # Firebase service-account JSON from a file, so its line breaks survive; optional, Android pushes are skipped without it
```

## Stickers

Custom stickers (我的表情) live in D1 (`sticker_objects`, `sticker_thumbs`, `member_stickers`, `sticker_counts`,
`sticker_daily`, migration 0019) and R2 (`sticker/<id>.<type>` and each uploader's still `sticker/<id>-t-<thumb>`).
自定义表情（我的表情）存放在 D1（`sticker_objects`、`sticker_thumbs`、`member_stickers`、`sticker_counts`、`sticker_daily`，迁移 0019）
和 R2（`sticker/<id>.<type>` 以及每位上传者的静态缩略图 `sticker/<id>-t-<thumb>`）中。

- The id is a keyed hash (`SESSION_SECRET`) of the file's SHA-256, which R2 verifies on every upload. The same bytes are stored once and shared by everyone who adds them.
- id 是文件 SHA-256 的带密钥哈希（`SESSION_SECRET`），R2 在每次上传时校验这个 SHA-256。相同的字节只存一份，由所有添加它的人共用。
- Every cap (999 per member, daily uploads, edits and full lists, stored bytes per member and for the club) is counted in D1 inside the same transaction as the write it guards.
- 每个上限（每人 999 个、每日上传、整理和完整列表次数、每人和全会的存储字节数）都在 D1 中、与它所保护的写入在同一个事务里计数。
- Recall, delete and removing from 我的表情 never delete a file. The hourly sweep (`17 * * * *`) deletes uploads that never finished after an hour, and files that were never sent and are in nobody's collection after a week.
- 撤回、删除和从我的表情中移除都不会删除文件。每小时一次的清理任务（`17 * * * *`）删除一小时后仍未完成的上传，以及一周后仍从未发出、也不在任何人表情列表中的文件。

### Blocking a sticker

The system administrator blocks a sticker with 封禁表情 on its long-press menu. When the app is not at hand, the same
request works with a superadmin session token (the bearer token the signed-in app sends):
系统管理员在表情的长按菜单中点按「封禁表情」即可封禁。手边没有 App 时，用系统管理员的会话令牌（已登录的 App 发送的 Bearer 令牌）发送同样的请求：

```bash
curl -X POST -H "authorization: Bearer <a superadmin session token>" -H "content-type: application/json" \
  -d '{"id":"stk_..."}' https://utmmsc.com/api/stickers/block
```

The id is the last path segment of the sticker's URL, without the `.gif` / `.png` / `.webp` / `.jpeg` ending (for
`.../sticker%2Fstk_AbC...xyz.gif?t=...` it is `stk_AbC...xyz`). The block takes the sticker out of every collection,
deletes its original and every still from R2, and keeps the row so the same bytes can never be uploaded or added
again. Rooms stop accepting it within 10 minutes; messages that showed it read 这个表情已失效. A `503` means the R2
delete failed after the block itself happened: send the same request again.
id 是表情网址的最后一段，去掉 `.gif` / `.png` / `.webp` / `.jpeg` 结尾（例如 `.../sticker%2Fstk_AbC...xyz.gif?t=...` 的 id 是
`stk_AbC...xyz`）。封禁会把表情从每个人的表情列表中移除，从 R2 删除原始文件和所有静态缩略图，并保留记录，相同的字节因此永远无法再次上传或添加。
房间在 10 分钟内停止接受它；显示过它的消息会显示「这个表情已失效」。返回 `503` 表示封禁本身已经生效，但 R2 删除失败：再发送一次同样的请求即可。

## Updating a deployment

Apply the D1 migration first, then deploy the Worker (it ships the Durable Object), then the web build:
先执行 D1 迁移，再部署 Worker（Durable Object 随之一起部署），最后部署网页：

```bash
npm run migrate:remote
npm run deploy
```

## First deployment

```bash
npx wrangler login
npx wrangler d1 create utmmsc          # paste database_id into wrangler.jsonc
npx wrangler r2 bucket create utmmsc-files
npx wrangler d1 migrations apply utmmsc --remote
npx wrangler secret put SESSION_SECRET # long random string
npx wrangler secret put BREVO_API_KEY  # from Brevo dashboard
npx wrangler secret put VAPID_PRIVATE_KEY   # see Notifications
npx wrangler deploy
```

The first account to register becomes `superadmin`.

## Local

```bash
cp .dev.vars.example .dev.vars        # fill SESSION_SECRET; leave BREVO_API_KEY empty to log codes
npm run migrate:local
npm run dev
```
