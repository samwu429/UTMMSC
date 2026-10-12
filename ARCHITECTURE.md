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
