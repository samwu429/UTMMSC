# apps/android

Android app for the UTMMSC member network. It is a Capacitor 8 shell that opens the live site `https://utmmsc.com/UTMMSC/`, so Android users share the same accounts, chats and messages as iPhone users on the website, and every web deploy reaches the app without a new APK. Only Android-specific behaviour is native.
UTMMSC 成员网络的安卓应用。它是一个 Capacitor 8 外壳，打开线上网站 `https://utmmsc.com/UTMMSC/`，因此安卓用户与在网页上使用的 iPhone 用户共用同一套账号、聊天和消息；网页每次发布都会直接到达应用，无需新的 APK。只有安卓特有的行为在原生层处理。

## Layout

```
capacitor.config.ts        app id, live URL, offline page, system bar style
www/index.html             offline page, shown only when the live site cannot load
android/                   Gradle project from `npx cap add android`, then customised
  variables.gradle         SDK levels and AndroidX versions
  app/build.gradle         versionCode, versionName, release signing
  app/src/main/java/com/utmmsc/app/
    MainActivity.java              Back button, downloads, offline page history
    PhotoCaptureChromeClient.java  camera for the chat 拍摄 button
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
- The app targets API 35 because only that platform is installed. To move to Capacitor 8's default of API 36, install platform `android-36`, then in `android/variables.gradle` set both SDK levels to 36, `androidxActivityVersion` to `1.11.0` and `androidxCoreVersion` to `1.17.0`.
- 由于只安装了 API 35 平台，应用目标为 API 35。如需改用 Capacitor 8 默认的 API 36，先安装 `android-36` 平台，再在 `android/variables.gradle` 中把两个 SDK 级别设为 36，`androidxActivityVersion` 设为 `1.11.0`，`androidxCoreVersion` 设为 `1.17.0`。
