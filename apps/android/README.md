# apps/android

Android app for the UTMMSC member network. It is a Capacitor 8 shell that opens the live site `https://utmmsc.com/UTMMSC/`, so Android users share the same accounts, chats and messages as iPhone users on the website, and every web deploy reaches the app without a new APK. Only Android-specific behaviour is native.
UTMMSC 成员网络的安卓应用。它是一个 Capacitor 8 外壳，打开线上网站 `https://utmmsc.com/UTMMSC/`，因此安卓用户与在网页上使用的 iPhone 用户共用同一套账号、聊天和消息；网页每次发布都会直接到达应用，无需新的 APK。只有安卓特有的行为在原生层处理。

## Layout

```
capacitor.config.ts        app id, live URL, offline page, system bar style
www/index.html             offline page, shown only when the live site cannot load
android/                   Gradle project from `npx cap add android`, then customised
  variables.gradle         SDK levels, AndroidX and Firebase Messaging versions
  app/build.gradle         versionCode, versionName, release signing, Firebase only when google-services.json exists
  app/google-services.json Firebase config for push (not in git, optional; see below)
  app/src/main/java/com/utmmsc/app/
    MainActivity.java              Back button, downloads, offline page history
    PhotoCaptureChromeClient.java  camera for the chat 拍摄 button
    AppPushPlugin.java             push plugin that cannot crash without Firebase, notification channels
  app/src/main/res/drawable-*/ic_stat_notify.png   notification icon, white brand mark
keystore/                  release keystore (not in git)
keystore.properties        keystore passwords (not in git)
```

## Build

Requirements: Android Studio's bundled JDK (JBR 25), and an Android SDK with platform `android-35` and build tools `35.0.0`. The Gradle wrapper downloads Gradle 9.5.1 on first use. Gradle stays on 9.5.x: Android Gradle Plugin 8.13 does not run on Gradle 9.6 or later, and Gradle before 9.1 does not run on JDK 25.
要求：Android Studio 自带的 JDK（JBR 25），以及装有 `android-35` 平台和 `35.0.0` 构建工具的 Android SDK。Gradle wrapper 首次运行时会下载 Gradle 9.5.1。Gradle 需停留在 9.5.x：Android Gradle Plugin 8.13 不能在 Gradle 9.6 及以上运行，而 9.1 之前的 Gradle 不能在 JDK 25 上运行。

```powershell
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME = 'D:\Android\Sdk'
npm run sync --workspace apps/android
cd apps/android/android
.\gradlew.bat assembleRelease
& "$env:ANDROID_HOME\build-tools\35.0.0\apksigner.bat" verify --print-certs app\build\outputs\apk\release\app-release.apk
```

The signed APK is `android/app/build/outputs/apk/release/app-release.apk`. `npm run sync` copies `www/` and the Capacitor config into `android/`; run it after changing `capacitor.config.ts`, `www/` or the Capacitor plugins, and on a fresh checkout, because the copied files are not in git. Web changes need no rebuild.
签名后的 APK 位于 `android/app/build/outputs/apk/release/app-release.apk`。`npm run sync` 把 `www/` 和 Capacitor 配置复制进 `android/`；修改 `capacitor.config.ts`、`www/` 或 Capacitor 插件后，以及新克隆仓库后都要运行，因为这些复制出的文件不在 git 中。网页改动无需重新构建。

## Signing key

Release builds are signed with `keystore/utmmsc-release.jks` (alias `utmmsc`), whose passwords are in `keystore.properties`. Both are gitignored, and `assembleRelease` stops with an error when either is missing. Back both up somewhere other than this machine, for example a password manager plus an encrypted drive. Android only installs an update signed with the same key, so if they are lost, every member has to uninstall the app and lose its local data before a new APK will install. Never commit them or send them in chat.
发布版用 `keystore/utmmsc-release.jks`（别名 `utmmsc`）签名，密码在 `keystore.properties` 中。两者都被 gitignore，缺任何一个 `assembleRelease` 都会报错停止。请把两者备份到这台电脑以外的地方，例如密码管理器加加密硬盘。安卓只接受同一密钥签名的更新，一旦丢失，每位成员都必须先卸载应用并丢失本地数据，才能安装新的 APK。切勿提交到 git 或通过聊天发送。

The certificate's SHA-256 fingerprint, for checking a downloaded APK with `apksigner verify --print-certs`:
证书的 SHA-256 指纹，可用 `apksigner verify --print-certs` 核对下载的 APK：

```
27ea0b831fa4d2630c1c053a9c50222c98ea6245adf53bf7432f3965a41c8cb2
```

## New version

A new APK is only needed when native parts change: `capacitor.config.ts`, `www/`, `android/` or the Capacitor plugins. In `android/app/build.gradle`, raise `versionCode` by one for every APK you publish (Android refuses an update whose code is lower than the installed one) and set `versionName` to the version members see, such as `1.0.1`. Then build, verify, and replace the file behind the Android download button on the homepage.
只有原生部分改动时才需要新的 APK：`capacitor.config.ts`、`www/`、`android/` 或 Capacitor 插件。在 `android/app/build.gradle` 中，每发布一个 APK 就把 `versionCode` 加一（版本号低于已安装版本时安卓会拒绝更新），并把 `versionName` 设为成员看到的版本，例如 `1.0.1`。然后构建、校验，并替换首页安卓下载按钮所指向的文件。

## Android push (Firebase) / 开启安卓推送（Firebase）

The app receives chat and event notifications through Firebase Cloud Messaging (FCM), which is free. Until the steps below are done, the APK still builds and runs, only without push: the build prints `google-services.json not found`, and the app's notification settings show 此版本暂不支持通知. Browsers and the home-screen web app use Web Push and do not need Firebase.
应用通过免费的 Firebase Cloud Messaging（FCM）接收聊天和活动通知。完成以下步骤之前，APK 照常构建运行，只是没有推送：构建时会打印 `google-services.json not found`，应用的通知设置显示「此版本暂不支持通知」。浏览器和添加到主屏幕的网页应用使用 Web Push，不需要 Firebase。

1. Open the [Firebase console](https://console.firebase.google.com/) with the club's Google account and choose **Create a project**. Any name works, for example `UTMMSC`. Google Analytics is not needed and can be turned off.
   用社团的 Google 账号打开 [Firebase 控制台](https://console.firebase.google.com/)，选择 **创建项目**（Create a project）。名称随意，例如 `UTMMSC`。不需要 Google Analytics，可以关闭。
2. On the project's home page, click the Android icon to add an app. The Android package name must be exactly `com.utmmsc.app`. The nickname and the debug signing certificate SHA-1 can stay empty; push does not need them. Click **Register app**.
   在项目首页点安卓图标添加应用。Android 软件包名称必须填 `com.utmmsc.app`，完全一致。应用昵称和调试签名证书 SHA-1 可以留空，推送不需要。点 **注册应用**（Register app）。
3. Download `google-services.json` and save it as `apps/android/android/app/google-services.json`. Skip the rest of the wizard: the Firebase SDK is already set up. The file only names the Firebase project and is not a secret, but it is gitignored until you decide to commit it. You can download it again at any time from Project settings → General → Your apps.
   下载 `google-services.json`，保存为 `apps/android/android/app/google-services.json`。向导其余步骤直接跳过：Firebase SDK 已经配置好。该文件只标识 Firebase 项目，不是密钥，但在你决定提交之前已被 gitignore。之后随时可以在 项目设置 → 常规 → 您的应用 中重新下载。
4. Open Project settings (the gear icon) → **Service accounts** → Firebase Admin SDK → **Generate new private key** → **Generate key**. A JSON file downloads. This file is a secret: whoever has it can send notifications to every member. Never commit it or send it in chat.
   打开 项目设置（齿轮图标）→ **服务账号**（Service accounts）→ Firebase Admin SDK → **生成新的私钥**（Generate new private key）→ **生成密钥**。浏览器会下载一个 JSON 文件。这个文件是密钥：拿到它的人可以给所有成员发通知。切勿提交到 git 或通过聊天发送。
5. Store it as the Worker secret `FCM_SERVICE_ACCOUNT`. Pipe the file in rather than pasting it into the prompt, so the multi-line JSON arrives intact:
   把它存为 Worker 密钥 `FCM_SERVICE_ACCOUNT`。请用管道传入文件，不要粘贴到提示符里，以免多行 JSON 被截断：

   ```powershell
   cd apps/api
   Get-Content -Raw C:\path\to\downloaded-key.json | npx wrangler secret put FCM_SERVICE_ACCOUNT
   ```

   The live Worker uses it at once and reads the project id from it. Then delete the downloaded file, or keep it only in the password manager.
   线上 Worker 立即使用该密钥，并从中读取项目 ID。之后删除下载的文件，或只保存在密码管理器中。
6. Rebuild and republish the APK: raise `versionCode` and `versionName` as described in New version, then run the commands under Build. The build no longer prints `google-services.json not found`. Verify the signature and replace the homepage download. Members have to install the new APK, because earlier ones cannot receive push.
   重新构建并发布 APK：按 New version 一节提高 `versionCode` 和 `versionName`，再执行 Build 一节的命令。构建时不再打印 `google-services.json not found`。校验签名后替换首页的下载文件。成员需要安装新的 APK，因为之前的版本收不到推送。
7. Check on a phone: install, sign in, open the 通知 page under 我的 / 设置, tap 开启通知 and allow, then tap 发送测试通知. The app goes to the home screen, and three seconds later a notification with the white UTMMSC book icon appears in the shade, because Android only shows pushes there while the app is in the background. Tapping it returns to the 通知 page, which says whether the notice arrived; when it did not, the page lists the system settings to check.
   在手机上检查：安装并登录，在 我的 / 设置 中打开 通知 页面，点 开启通知 并允许，再点 发送测试通知。应用会退到桌面，三秒后通知栏出现带白色 UTMMSC 书本图标的通知，因为安卓只在应用处于后台时才把推送显示在那里。点开它会回到 通知 页面，页面会说明通知是否到达；没有到达时会列出需要检查的系统设置。

FCM needs Google Play services. Phones without them, such as most phones sold for mainland China and Huawei phones since 2019, cannot turn on notifications in the app; their members still see new messages and events when they open it.
FCM 依赖 Google Play 服务。没有该服务的手机（例如大多数国行手机，以及 2019 年以后的华为手机）无法在应用中开启通知；这些成员打开应用时仍能看到新消息和活动。

## Behaviour

- Pages on `utmmsc.com` stay in the app; links to other hosts, `mailto:` and `tel:` open in the browser, mail app or dialer.
- 站内 `utmmsc.com` 页面留在应用内；其他网站链接、`mailto:` 和 `tel:` 交给浏览器、邮件应用或拨号器打开。
- Back goes back through the web history and sends the app to the background from the first page. If the page registers `App.addListener('backButton', ...)`, the page handles Back instead.
- 返回键沿网页历史后退，在第一页时把应用退到后台。如果网页注册了 `App.addListener('backButton', ...)`，则由网页处理返回键。
- The offline page appears when the live site cannot load, mostly on a first launch without network; later launches usually open the copy the service worker cached.
- 线上网站无法加载时显示离线页，主要出现在首次无网络启动时；之后的启动通常会打开服务工作线程缓存的版本。
- The app declares no camera permission: the 拍摄 button hands off to the system camera app, which needs none. The photo is saved in the app's private cache, which other apps cannot read, and is deleted the next time the app starts.
- 应用不声明相机权限：拍摄按钮交给系统相机应用处理，无需该权限。照片保存在其他应用无法读取的应用私有缓存中，并在应用下次启动时删除。
- Only pages on `https://utmmsc.com` and the bundled offline page can call the native plugins, and only from the main frame, never from an embedded frame. Keep `server.url` in `capacitor.config.ts` a bare origin and put the path in `appStartPath`; a path in `server.url` makes Android expose the plugins to every frame.
- 只有 `https://utmmsc.com` 上的页面和打包的离线页能调用原生插件，而且只能在主框架中调用，嵌入的框架不行。`capacitor.config.ts` 中的 `server.url` 只写源，路径放在 `appStartPath`；`server.url` 带路径时，安卓会把插件暴露给所有框架。
- Cloud backup and device transfer are off, so the login token never leaves the phone.
- 关闭云备份和换机迁移，登录令牌不会离开手机。
- With the app in the background or closed, Android shows each push in the notification tray with the white book icon in UTMMSC purple. Tapping it opens the app, and the page receives `pushNotificationActionPerformed` with the push's `url` in `notification.data` and goes there. While the app is open, Android shows nothing and the page receives `pushNotificationReceived` instead, so the chat you are reading never pings.
- 应用在后台或已关闭时，安卓把每条推送显示在通知栏，图标为 UTMMSC 紫色的白色书本。点击通知会打开应用，网页收到 `pushNotificationActionPerformed`，其 `notification.data` 中带有推送的 `url`，网页随即跳转过去。应用在前台时安卓不显示通知，改由网页收到 `pushNotificationReceived`，因此正在看的聊天不会再响一次。
- The channels 消息 (urgent, pops up on screen) and 活动 (high) are created on the first launch, and members can change their sound and vibration or turn either off in Android settings → Apps → UTMMSC → Notifications. Android 13 and later ask for permission only when the member turns notifications on, and no push token exists before then.
- 首次启动时创建 消息（紧急，会在屏幕上弹出）和 活动（高）两个通知渠道，成员可在 安卓设置 → 应用 → UTMMSC → 通知 中分别调整声音、振动或关闭。Android 13 及以上只在成员开启通知时请求权限，此前不会生成推送令牌。
- Before Android 13, the push permission reads `denied` when the member turned UTMMSC's notifications off in Android settings; the stock plugin always says `granted` there. From 1.2.0, `PushNotifications.openSettings()` opens the app's notification settings, and the 通知 page offers it when notifications or a channel are off.
- Android 13 以前，成员在安卓设置中关闭了 UTMMSC 的通知时，推送权限显示为 `denied`；原版插件在这些系统上总是回答 `granted`。从 1.2.0 起，`PushNotifications.openSettings()` 打开本应用的通知设置；通知或某个渠道被关闭时，通知 页面会提供这个按钮。
- A tapped notice that started the app is not replayed when Android recreates the activity later, for example after reclaiming it in the background.
- 启动应用的那次通知点击，在安卓之后重新创建 Activity 时（例如在后台回收之后）不会被重放。
- In a build without `google-services.json`, `PushNotifications.register()` rejects with code `UNAVAILABLE` and also fires `registrationError`, where the stock plugin would crash the app; the page then shows 此版本暂不支持通知.
- 在没有 `google-services.json` 的构建中，`PushNotifications.register()` 以 `UNAVAILABLE` 代码拒绝，并同时触发 `registrationError`，而原版插件会让应用崩溃；网页随后显示「此版本暂不支持通知」。
- The app targets API 35 because only that platform is installed. To move to Capacitor 8's default of API 36, install platform `android-36`, then in `android/variables.gradle` set both SDK levels to 36, `androidxActivityVersion` to `1.11.0` and `androidxCoreVersion` to `1.17.0`.
- 由于只安装了 API 35 平台，应用目标为 API 35。如需改用 Capacitor 8 默认的 API 36，先安装 `android-36` 平台，再在 `android/variables.gradle` 中把两个 SDK 级别设为 36，`androidxActivityVersion` 设为 `1.11.0`，`androidxCoreVersion` 设为 `1.17.0`。
