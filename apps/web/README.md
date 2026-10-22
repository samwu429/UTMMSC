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
      api.ts               ticket, info, members, prefs, read, clear, images, translate
      pages/               chat list, search, full-screen room, chat info
      list/                merged conversation list: rows, avatars, row menu, preview rules
      room/                room screen, title bar, viewport pinning, timeline, bubbles,
                           message menu, tips, images and viewer, jump pills
      composer/            input bar, emoji and more panels, mention picker, quote strip,
                           image preparation
      info/                chat info cells, member grid and member list, switch
      state/               conversation overview store, drafts, safe localStorage
      format/              system and recall wording (systemText.ts)
      transport/           useRoomSocket and its pure parts: message store, outbox,
                           history requests, upload with progress, room cache
      components/          unread badge
    files/                 categorised library with upload and authenticated download
    admin/                 approvals, roles, channels, events, announcements
    settings/              profile, password change, install hint, sign out
  shared/
    api/                   base URL, fetch wrapper, error helpers
    session/               persisted session store
    ui/                    buttons, fields, cards, badges, wx tokens, toast, action sheet,
                           anchored layer, long press, spinner
    format/                time and size formatting
```

## Environment

`VITE_API_BASE_URL` points at the Worker. The GitHub Actions workflow sets it; local development falls back to the production Worker unless you create `apps/web/.env.local` with `VITE_API_BASE_URL=http://localhost:8787`.

## Tests

`npm run test --workspace apps/web` runs Vitest in the node environment over `src/**/*.test.ts`. Tests cover pure modules only (message store, outbox, history requests, timeline, linkify, image boxes, mention tokens, image preparation, conversations, overview store, drafts, time labels, system wording, token contrast), so nothing under test may touch `window` at import time.
`npm run test --workspace apps/web` 在 node 环境下用 Vitest 运行 `src/**/*.test.ts`。测试只覆盖纯模块（消息存储、发送队列、历史请求、时间线、链接识别、图片尺寸、@ 标记、图片预处理、会话列表、概览 store、草稿、时间文字、系统文案、配色对比度），因此被测模块在导入时不能访问 `window`。

## Chat interaction rules

The chat screens follow WeChat's layout and interaction. Own bubbles use the club gold (`wx.mine` in `shared/ui/wxTokens.ts`); WeChat green is a one-token swap there.
聊天界面遵循微信的布局和交互。自己的气泡使用社团金色（`shared/ui/wxTokens.ts` 中的 `wx.mine`）；改成微信绿只需替换那一个色值。

- The chat tab is one list mixing channels and direct messages, sorted by activity with pinned chats first. Long press or right-click a row for 标为已读/未读, 置顶, 消息免打扰 and 不显示该聊天.
- 聊天标签是一个混合频道与私聊的列表，置顶会话在前，其余按最近活动排序。长按或右键某一行可以标为已读或未读、置顶、消息免打扰和不显示该聊天。
- The room is a column of title bar, timeline and composer pinned to the visual viewport, so the keyboard and the emoji or more panels keep the newest message right above the input and the page never scrolls. The title shows 「频道名(人数)」 or the peer name, never an online count, and a connection line (连接中… / 收取中… / 未连接) only while not connected.
- 房间由标题栏、时间线和输入栏组成一列，固定在可见视口内，键盘或表情、更多面板弹出时最新消息仍紧贴输入栏，页面本身不会滚动。标题显示「频道名(人数)」或对方名字，不显示在线人数；只有未连接时才显示连接状态（连接中… / 收取中… / 未连接）。
- A single tap on a bubble does nothing. A 450ms long press, a right-click or the hidden 消息操作 button opens the dark menu: 复制, 引用, 撤回 (within 3 minutes, no confirmation), 删除 (hides it for you on all your devices), 翻译, and for moderators in channels 删除（管理员） and 禁言 on members below their tier.
- 单击气泡没有任何反应。长按 450 毫秒、右键或隐藏的「消息操作」按钮会打开深色菜单：复制、引用、撤回（3 分钟内，无需确认）、删除（只在你自己的所有设备上隐藏）、翻译；在频道中，管理员对档位低于自己的成员另有删除（管理员）和禁言。
- Entering a room marks everything read while the page is visible. The back button shows the other chats' unread count. More than a screen of unread shows the 「N条新消息」 pill, and an @ shows 「有人@我」.
- 页面可见时，进入房间即把内容标为已读。返回键显示其他会话的未读数。未读超过一屏时显示「N条新消息」胶囊，有人 @ 时显示「有人@我」。
- Older pages load from a top sentinel behind a gray spinner and keep the reading position. Reconnects catch up instead of reloading, and sends queue in an outbox, so the composer is never disabled for connectivity.
- 更早的消息由顶部哨兵在灰色加载图标后加载，并保持阅读位置。重连时补齐缺口而不是重新加载，发送进入队列，输入栏不会因为网络状态被禁用。
- Channels follow the history floor: a member who joins later sees messages from their join on, unless staff turn on 新成员可查看历史消息 for that channel.
- 频道遵循历史下限：之后加入的成员只能看到加入之后的消息，除非管理员为该频道打开「新成员可查看历史消息」。
- 聊天信息 (the ··· button) shows members, the channel name, notice and history rule, 消息免打扰, 置顶聊天 and 清空聊天记录, which clears the history for you only.
- 聊天信息（··· 按钮）显示成员、频道名称、公告和历史消息规则，以及消息免打扰、置顶聊天和清空聊天记录（只清空你自己的记录）。
