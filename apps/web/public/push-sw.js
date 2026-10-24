/*
 * Push handling, loaded into the generated service worker with importScripts (vite.config.ts).
 * The server sends a JSON PushPayload: { title, body, tag, url, kind, roomId?, eventId?, postId? }. Kind recall
 * replaces the notice of a withdrawn message under the same tag, without sound. Kind moment is a comment, a
 * reply or a moderator's removal in 好友动态, and moment_recall quietly replaces the notice of a deleted comment.
 * 推送处理，通过 importScripts 加载到生成的 Service Worker 中（见 vite.config.ts）。
 * 服务器发送 JSON 格式的 PushPayload：{ title, body, tag, url, kind, roomId?, eventId?, postId? }。recall 类型以相同 tag
 * 替换已撤回消息的通知，且不发出声音。moment 类型是好友动态中的评论、回复或管理员移除；moment_recall 安静地替换已删除评论的通知。
 */
(function () {
  var SCOPE = self.registration.scope;
  var SCOPE_PATH = new URL(SCOPE).pathname;
  var ICON = SCOPE + 'icons/icon-192.png';
  var BADGE = SCOPE + 'icons/badge-96.png';
  var NAVIGATE = 'utmmsc:navigate';
  var WHERE = 'utmmsc:where';
  var SHOWN = 'utmmsc:shown';
  // MOMENTS_PUSH_MESSAGE in features/moments/model.ts.
  // 即 features/moments/model.ts 中的 MOMENTS_PUSH_MESSAGE。
  var MOMENTS = 'utmmsc:moments';
  var MOMENTS_PATH = SCOPE_PATH + 'discover/feed';
  var WHERE_WAIT_MS = 500;

  function readPayload(event) {
    var fallback = { title: 'UTMMSC', body: '你收到一条新消息', tag: 'utmmsc', url: SCOPE, kind: 'message' };
    if (!event.data) return fallback;
    try {
      var data = event.data.json();
      if (!data || typeof data !== 'object') return fallback;
      return {
        title: typeof data.title === 'string' && data.title ? data.title : fallback.title,
        body: typeof data.body === 'string' ? data.body : '',
        tag: typeof data.tag === 'string' && data.tag ? data.tag : fallback.tag,
        url: typeof data.url === 'string' ? data.url : SCOPE,
        kind: typeof data.kind === 'string' ? data.kind : 'message',
        roomId: typeof data.roomId === 'string' ? data.roomId : null,
        postId: typeof data.postId === 'string' ? data.postId : null,
      };
    } catch (_) {
      return fallback;
    }
  }

  /**
   * Links point at the production app; any path under the app is opened on this origin instead, and
   * anything else opens the app's home.
   * 链接指向线上应用；应用路径下的地址一律改在本站打开，其他地址打开应用首页。
   */
  function localUrl(raw) {
    try {
      var url = new URL(raw, SCOPE);
      if (url.pathname.indexOf(SCOPE_PATH) !== 0) return SCOPE;
      return new URL(url.pathname + url.search + url.hash, self.location.origin).href;
    } catch (_) {
      return SCOPE;
    }
  }

  function roomOfUrl(raw) {
    try {
      var path = new URL(raw).pathname;
      var prefix = SCOPE_PATH + 'chat/room/';
      if (path.indexOf(prefix) !== 0) return null;
      var rest = path.slice(prefix.length).split('/');
      // The info page of a room is not the conversation itself.
      // 房间的资料页不是会话本身。
      if (rest.length !== 1 || !rest[0]) return null;
      return decodeURIComponent(rest[0]);
    } catch (_) {
      return null;
    }
  }

  /**
   * Client.url keeps the address a window was opened at, since moves inside the app do not change it, so
   * the window is asked where it is now. A window running an older build that does not answer is judged by
   * its url.
   * Client.url 保留窗口打开时的地址，应用内跳转不会改变它，所以要问窗口现在在哪里。运行旧版本、没有回应的窗口按其 url 判断。
   */
  function currentUrl(client) {
    return new Promise(function (resolve) {
      var channel = new MessageChannel();
      var timer = setTimeout(function () {
        channel.port1.close();
        resolve(client.url);
      }, WHERE_WAIT_MS);
      channel.port1.onmessage = function (event) {
        clearTimeout(timer);
        channel.port1.close();
        resolve(typeof event.data === 'string' ? event.data : client.url);
      };
      client.postMessage({ type: WHERE }, [channel.port2]);
    });
  }

  /**
   * The 好友动态 home feed only, which shows new activity itself (the bubble above the posts). A post, the notices,
   * an album or the settings show nothing new, so a push there is still shown.
   * 仅限好友动态首页，它会自己显示新的互动（动态上方的气泡）。动态详情、消息、相册或设置页面不会显示新的互动，因此在那里仍显示推送。
   */
  function onMomentsHome(raw) {
    try {
      var path = new URL(raw).pathname;
      return path === MOMENTS_PATH || path === MOMENTS_PATH + '/';
    } catch (_) {
      return false;
    }
  }

  /** Whether a focused, visible window of the app is on a page that `matches`. */
  /** 是否有获得焦点且可见的应用窗口正停在符合 `matches` 的页面上。 */
  function viewing(windows, matches) {
    var visible = windows.filter(function (client) {
      return client.focused && client.visibilityState === 'visible';
    });
    return Promise.all(visible.map(currentUrl)).then(function (urls) {
      return urls.some(matches);
    });
  }

  /**
   * Apple revokes a subscription whose pushes show nothing, so there the notice is shown and closed at once.
   * Apple 会撤销推送后不显示通知的订阅，因此在 Apple 设备上先显示再立即关闭。
   */
  function strictPushService() {
    return self.registration.pushManager.getSubscription().then(function (subscription) {
      if (!subscription) return false;
      try {
        return /(^|\.)push\.apple\.com$/.test(new URL(subscription.endpoint).hostname);
      } catch (_) {
        return false;
      }
    });
  }

  function isChat(payload) {
    return payload.kind === 'message' || payload.kind === 'recall';
  }

  function isMoment(payload) {
    return payload.kind === 'moment' || payload.kind === 'moment_recall';
  }

  /**
   * A chat push is left out while its room is on screen; a moments push while the 好友动态 home feed is, since
   * only that page shows the new activity itself.
   * 正在查看对应房间时不显示聊天推送；正在查看好友动态首页时不显示动态推送，因为只有这个页面会自己显示新的互动。
   */
  function viewingTarget(windows, payload) {
    if (isChat(payload)) {
      if (!payload.roomId) return Promise.resolve(false);
      return viewing(windows, function (url) {
        return roomOfUrl(url) === payload.roomId;
      });
    }
    if (isMoment(payload)) return viewing(windows, onMomentsHome);
    return Promise.resolve(false);
  }

  function show(payload) {
    var quiet = payload.kind === 'recall' || payload.kind === 'moment_recall';
    return self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: ICON,
      badge: BADGE,
      tag: payload.tag,
      // A newer message in the same chat, or a newer comment on the same post, replaces the older notice and
      // still alerts; a withdrawal or a deleted comment only replaces it.
      // 同一聊天的新消息、同一动态的新评论替换旧通知，并仍然提醒；撤回和已删除的评论只替换，不提醒。
      renotify: payload.kind === 'message' || payload.kind === 'moment',
      silent: quiet,
      lang: 'zh-CN',
      data: { url: localUrl(payload.url), kind: payload.kind, roomId: payload.roomId, postId: payload.postId },
    });
  }

  function closeTagged(tag) {
    if (typeof self.registration.getNotifications !== 'function') return Promise.resolve();
    return self.registration
      .getNotifications({ tag: tag })
      .then(function (list) {
        list.forEach(function (notification) {
          notification.close();
        });
      })
      .catch(function () {});
  }

  /**
   * A second test replaces the first notice under the same tag, which browsers do without alerting, so a
   * test first closes the one still on screen.
   * 第二次测试会以相同 tag 替换第一条通知，而浏览器替换时不会提醒，所以测试先关掉仍在屏幕上的那条。
   */
  function showAfresh(payload) {
    if (payload.kind !== 'test' || typeof self.registration.getNotifications !== 'function') return show(payload);
    return self.registration
      .getNotifications({ tag: payload.tag })
      .then(function (list) {
        list.forEach(function (notification) {
          notification.close();
        });
      })
      .catch(function () {})
      .then(function () {
        return show(payload);
      });
  }

  /**
   * Tells the open windows that a test notice was shown, so the settings screen can confirm it.
   * 告诉已打开的窗口测试通知已经显示，设置页因此可以确认。
   */
  function announceShown(payload) {
    if (payload.kind !== 'test') return undefined;
    return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (windows) {
      windows.forEach(function (client) {
        if (client.url.indexOf(SCOPE) === 0) client.postMessage({ type: SHOWN, kind: payload.kind });
      });
    });
  }

  /**
   * Tells the open windows that a moments push arrived, whether or not a notice was shown, so the 发现 badge and
   * an open 好友动态 page catch up at once.
   * 告诉已打开的窗口收到了好友动态推送（无论是否显示了通知），「发现」角标和已打开的好友动态页面因此能立即更新。
   */
  function announceMoments(payload) {
    if (!isMoment(payload)) return undefined;
    return self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(function (windows) {
        windows.forEach(function (client) {
          if (client.url.indexOf(SCOPE) === 0) client.postMessage({ type: MOMENTS, kind: payload.kind, postId: payload.postId });
        });
      })
      .catch(function () {});
  }

  self.addEventListener('push', function (event) {
    var payload = readPayload(event);
    var handled = self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(function (windows) {
        return viewingTarget(windows, payload);
      })
      .then(function (viewing) {
        if (!viewing) {
          return showAfresh(payload).then(function () {
            return announceShown(payload);
          });
        }
        return strictPushService().then(function (strict) {
          // Nothing is shown, but the text of a deleted comment still leaves the tray.
          // 不显示通知，但已删除评论的内容仍要从通知栏里去掉。
          if (!strict) return payload.kind === 'moment_recall' ? closeTagged(payload.tag) : undefined;
          return show(payload)
            .then(function () {
              return self.registration.getNotifications({ tag: payload.tag });
            })
            .then(function (list) {
              list.forEach(function (notification) {
                notification.close();
              });
            });
        });
      });
    event.waitUntil(Promise.all([handled, announceMoments(payload)]));
  });

  /**
   * Asks an open window to route there itself, which keeps the app loaded; a window running an older
   * build that does not answer is navigated instead.
   * 请已打开的窗口自行跳转，应用无需重新加载；运行旧版本、没有回应的窗口则直接导航。
   */
  function routeClient(client, url) {
    return new Promise(function (resolve) {
      var channel = new MessageChannel();
      var timer = setTimeout(function () {
        channel.port1.close();
        resolve(false);
      }, 1500);
      channel.port1.onmessage = function () {
        clearTimeout(timer);
        channel.port1.close();
        resolve(true);
      };
      client.postMessage({ type: NAVIGATE, url: url }, [channel.port2]);
    }).then(function (handled) {
      if (handled || typeof client.navigate !== 'function') return client;
      return client.navigate(url).catch(function () {
        return client;
      });
    });
  }

  self.addEventListener('notificationclick', function (event) {
    event.notification.close();
    var data = event.notification.data || {};
    var url = localUrl(typeof data.url === 'string' ? data.url : SCOPE);
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (windows) {
        var inScope = windows.filter(function (client) {
          return client.url.indexOf(SCOPE) === 0;
        });
        var client =
          inScope.find(function (c) {
            return c.focused;
          }) ||
          inScope.find(function (c) {
            return c.visibilityState === 'visible';
          }) ||
          inScope[0];
        if (!client) return self.clients.openWindow(url);
        return client
          .focus()
          .catch(function () {
            return client;
          })
          .then(function (focused) {
            return routeClient(focused || client, url);
          });
      }),
    );
  });
})();
