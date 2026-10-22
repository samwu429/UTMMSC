# Architecture

UTMMSC is a member network for one student organization at the University of Toronto. The product centre is chat: large channels that every member can join, plus one-to-one direct messages. Accounts, the member directory, roles, the file library, and the daily card exist to support that network.

UTMMSC 是一个学生社团的成员网络。产品核心是聊天：全员可进的大频道，加上一对一私聊。账号、成员目录、身份、文件库和每日卡片都为这个网络服务。

## Deployment shape

| Part | Runs on | Why |
| --- | --- | --- |
| `apps/web` | Static files inside the `utmmsc.com` Worker, at `/UTMMSC/` | The member app stays on a path so the apex can be the public site. |
| `apps/site` | Cloudflare Worker on `utmmsc.com` | Public home page at `/`, and the member app files at `/UTMMSC/`. |
| `apps/api` | Cloudflare Workers | Request handlers, session checks, D1, R2, email, weather. |
| `ChatRoom` | Cloudflare Durable Objects | One object per channel or direct conversation; hibernating WebSockets. |
| Relational data | Cloudflare D1 | Members, roles, channels, memberships, files, events. |
| Message history | Durable Object SQLite | Each room owns its own messages and read cursors. |
| Binary files | Cloudflare R2 | Chat images and governance documents, by category prefix. |
| Email | Brevo (free tier) | Verification codes, manual-approval results, executive announcements. |

The browser opens `utmmsc.com` for the public site and `utmmsc.com/UTMMSC/` for the member app. API calls and room WebSockets go to the API Worker. The API Worker is the only component that reads or writes D1, R2, email, or room objects.

## Repository layout

```
apps/web        Vite + React single-page app (PWA)
apps/site       Public-site Worker for utmmsc.com
apps/api        Cloudflare Worker (Hono) + Durable Objects + D1 migrations
packages/shared Types, role/permission table, email rules, chat protocol shared by both apps
```

Within each app, folders mirror responsibility and subdivide by feature. See the `README.md` inside each app for the next level of detail.

## Dependency direction

```
apps/web  ->  packages/shared
apps/api  ->  packages/shared
apps/api/http -> apps/api/domain -> apps/api/infrastructure
apps/api/realtime -> apps/api/domain
```

`domain` holds pure rules (email domains, password hashing, token signing, permission checks) and must not import from `http`, `realtime`, or `infrastructure`. `infrastructure` wraps external systems (D1, R2, Brevo, Open-Meteo). `http` and `realtime` compose the two.

## Identity

- Registration accepts University of Toronto addresses only (`mail.utoronto.ca`, `utoronto.ca`, `alumni.utoronto.ca`), verified by a six-digit emailed code.
- Graduates who no longer control a university address submit a manual application that an executive approves.
- Sessions are HMAC-signed bearer tokens that also exist as rows in D1 so they can be revoked.
- WebSocket connections use a short-lived signed ticket issued over HTTPS; the ticket names the member and the room.

## Roles

Five fixed roles form an ordered ladder: `student`, `alumni`, `department_lead`, `executive`, `superadmin`. Permissions are a static table in `packages/shared`; the admin UI assigns a role and never edits individual permissions.

## Rooms

A `ChatRoom` Durable Object serves one channel or one direct conversation. It accepts WebSockets with the hibernation API, validates each inbound frame against the shared protocol, stores messages and read cursors in its SQLite storage, and broadcasts to connected sockets only. Membership and audience checks happen in the Worker before the socket is handed to the room.

`ChatRoom` 是一个 Durable Object，每个实例服务一个频道或一个私聊。它用休眠 API 接受 WebSocket，按共享协议校验每一帧入站消息，把消息和已读游标存在自己的 SQLite 里，只向已连接的连接广播。成员资格和受众检查在 Worker 中完成，之后才把连接交给房间。

### History floor / 历史下限

Channels follow WeChat: a member who joins a channel after the policy started sees only messages from their join on. The Worker computes the floor and puts it in the room ticket; the room enforces it on every page, catch-up, quote, unread count and list preview.

频道规则与微信一致：在策略生效之后加入频道的成员，只能看到加入之后的消息。下限由 Worker 计算并写进房间票据；房间在每一页历史、每次补齐、每个引用、未读数和列表预览中都执行它。

- Join time comes from `channel_memberships.joined_at` for custom channels. For audience channels it comes from `channel_joins` (written when an admin role or enrollment change makes the member newly eligible), or else the later of the member's and the channel's creation time.
- 指定成员频道的加入时间取 `channel_memberships.joined_at`。受众频道取 `channel_joins`（管理员修改身份或在读状态、使成员新获得资格时写入），没有时取成员创建时间与频道创建时间中较晚的一个。
- Members whose join is earlier than `channels.history_floor_since` are grandfathered and keep the full history. Migration 0013 sets that instant for every existing channel, new channels use their creation time, and switching a channel back to since_join moves it to now.
- 加入时间早于 `channels.history_floor_since` 的成员保留完整历史。迁移 0013 为所有现有频道设置该时刻，新频道使用创建时间，频道切回 since_join 时该时刻更新为当前时间。
- Staff can turn on 新成员可查看历史消息 (`history_visibility = 'all'`) per channel. Members whose viewed role has `channels.manage` are never floored, and direct messages never have a floor.
- 负责人可以按频道打开「新成员可查看历史消息」（`history_visibility = 'all'`）。当前视角身份拥有 `channels.manage` 的成员不受下限限制，私聊永远没有下限。
- Unread counting starts at the join, so a new member does not inherit every earlier message as unread. Clearing chat history raises that member's own floor without touching anyone else.
- 未读从加入处开始计算，新成员不会把之前的消息全部算作未读。清空聊天记录只会抬高该成员自己的下限，不影响其他人。
- Missing columns or tables fail open: no floor and empty list settings, never hidden history.
- 缺少列或表时按不设下限处理：没有下限、列表设置为空，绝不会隐藏历史。

### Sync and redaction / 同步与清理

Every change to a stored row and every hide takes the next room revision. A reconnecting client sends its newest id, oldest id and last revision, and gets new rows, changed rows and its own hides instead of a fresh page. More than 50 changes tell it to reload the latest page.

已存消息的每次变更和每次隐藏都会取下一个房间版本号。重连的客户端发送它最新的 id、最旧的 id 和最后的版本号，拿到的是新消息、变更过的消息和自己的隐藏，而不是重新加载一页。变更超过 50 条时，客户端改为重新加载最新一页。

Sends carry a client id that doubles as an idempotency key, so a resend after a lost acknowledgement never creates a second row. Quotes are built when history is read, so a recalled, deleted or below-floor target shows only its state. Recalled and deleted bodies are never sent again in history, catch-up, broadcasts, quotes or previews.

发送带有客户端 id，同时作为幂等键，确认丢失后的重发不会产生第二条消息。引用在读取历史时生成，被撤回、删除或在下限以下的消息只显示其状态。撤回和删除的正文不会再出现在历史、补齐、广播、引用或预览中。

Pin, mute, mark-as-unread and hide are stored per member and room in D1 (`chat_prefs`) and synced through the overview. The overview asks each room for one summary, so the client polls it only while the chat tab is open.

置顶、免打扰、标为未读和隐藏按成员和房间存在 D1（`chat_prefs`）中，通过概览同步。概览会向每个房间请求一次摘要，因此客户端只在聊天页打开时轮询。

Deploy order: apply the D1 migration, then deploy the API Worker together with the Durable Object, then the web build.

部署顺序：先执行 D1 迁移，再一起部署 API Worker 与 Durable Object，最后部署网页。
