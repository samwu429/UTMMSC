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
      chat/             overview, direct, room tickets, socket upgrade, images, media
      channels/         create, update, membership (channels.manage)
      files/            list, upload, download, delete
      home/             daily card
      admin/            applications, roles, status, events, announcements
  realtime/
    rooms/chat-room.ts  Durable Object: hibernating WebSockets, SQLite history, read cursors, mutes
  domain/
    crypto/             base64url, HMAC sign/verify
    identity/           password hashing, session tokens, room tickets, verification codes
    authorization/      channel read/post rules
    messaging/          preview text
  infrastructure/
    d1/                 one module per table
    r2/                 object keys and put/get/delete
    email/              Brevo client and Chinese templates
    weather/            Open-Meteo
migrations/             D1 schema
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
