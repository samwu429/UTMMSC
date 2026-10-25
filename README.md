# UTMMSC

Member network for UTMMSC: a members-only web app with large chat channels, direct messages, a graduate and student directory, role-based administration for the executive team, a categorised file library, and a daily card with date, Toronto weather, and upcoming events.

UTMMSC 成员网络：面向成员的网页应用，提供大频道聊天、私聊、在校生与毕业生目录、给主席团使用的身份管理、分类文件库，以及显示日期、多伦多天气和近期活动的每日卡片。

Public site: https://utmmsc.com/ (built in the [MSC-WEB](https://github.com/samwu429/MSC-WEB) repository as the `msc-web` Worker; this repository's site Worker forwards every path the member network does not use to it)

Member network: https://utmmsc.com/UTMMSC/

The member network is only at the address above. GitHub Pages for this repository is not used.

## Structure

```
apps/web         Front end (Vite, React, Tailwind, PWA)
apps/site        Cloudflare Worker for utmmsc.com: member app at `/UTMMSC/`, API at `/api/`, everything else forwarded to the public site (`msc-web`)
apps/api         Cloudflare Worker, Durable Objects, D1 migrations
packages/shared  Shared types and rules
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the system shape.

## Local development

Requirements: Node 20 or newer, a Cloudflare account (free plan is enough), a Brevo account for email.

```bash
npm install

# Terminal 1: Worker with local D1 and Durable Objects
npm run dev:api

# Terminal 2: web app at http://localhost:5173/UTMMSC/
npm run dev:web
```

Create `apps/api/.dev.vars` (ignored by git) with the keys listed in `apps/api/.dev.vars.example`.

## Deployment

- Member network and the front door: `npm run deploy:site` after `npx wrangler login`. This builds `apps/web` and publishes it with the `utmmsc.com` Worker. `/UTMMSC/` is the member network. Do not attach the member app to the apex. Every other path goes to the public website through the `WEB` service binding, so deploy `msc-web` from the MSC-WEB repository first. In local development, where the binding is absent, the apex shows the holding page.
- Pushing to `main` checks the code. It does not publish the site. Publish with `npm run deploy:site`.
- API: `npm run deploy:api` after `npx wrangler login`. Secrets are set with `npx wrangler secret put <NAME>` inside `apps/api`. The Worker runs at `https://utmmsc-api.utmmsc.workers.dev`.
- Files: the R2 bucket `utmmsc-files` is bound as `FILES`. Chat images and the file library are stored there.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | TypeScript across all workspaces |
| `npm run lint` | ESLint across all workspaces |
| `npm run test` | Vitest across all workspaces |
