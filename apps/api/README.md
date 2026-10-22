# apps/api

Cloudflare Worker that serves the UTMMSC API and hosts the `ChatRoom` Durable Object.

## Layout

```
src/
  index.ts              Worker entry; exports the fetch handler and ChatRoom
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
      admin/            applications, roles, status, events, announcements
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
  infrastructure/
    d1/                 one module per table; chat also uses channel-joins, chat-prefs, room-members
    r2/                 object keys and put/get/delete
    email/              Brevo client and Chinese templates
    weather/            Open-Meteo
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
npx wrangler deploy
```

The first account to register becomes `superadmin`.

## Local

```bash
cp .dev.vars.example .dev.vars        # fill SESSION_SECRET; leave BREVO_API_KEY empty to log codes
npm run migrate:local
npm run dev
```
