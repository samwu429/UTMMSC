# apps/web

Mobile-first single-page app for UTMMSC members. Built with Vite, React, TypeScript, Tailwind CSS, and `vite-plugin-pwa`. The site Worker publishes the build at `https://utmmsc.com/UTMMSC/`.

## Layout

```
src/
  main.tsx                 Entry
  app/
    App.tsx                Router and guards (guest, session, staff)
    layout/AppShell.tsx    Bottom tab bar shell
    pwa.ts                 Service worker registration
    styles.css             Tailwind layers and base styles
  features/
    auth/                  login, register, apply, forgot; code field; profile fields
    home/                  daily card: date, Toronto weather, upcoming events
    directory/             member list with filters and keyset paging; profile with "message" action
    chat/
      pages/               overview (channels, direct) and full-screen room
      transport/           useRoomSocket: ticket, WebSocket, reconnect, history, read cursor
      channels/ direct/    list components
      components/          message bubble, composer, unread badge
    files/                 categorised library with upload and authenticated download
    admin/                 approvals, roles, channels, events, announcements
    settings/              profile, password change, install hint, sign out
  shared/
    api/                   base URL, fetch wrapper, error helpers
    session/               persisted session store
    ui/                    buttons, fields, cards, badges
    format/                time and size formatting
```

## Environment

`VITE_API_BASE_URL` points at the Worker. The GitHub Actions workflow sets it; local development falls back to the production Worker unless you create `apps/web/.env.local` with `VITE_API_BASE_URL=http://localhost:8787`.
