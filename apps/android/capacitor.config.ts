import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.utmmsc.app',
  appName: 'UTMMSC',
  webDir: 'www',
  backgroundColor: '#F7F4EE',
  server: {
    // The app always opens the live member network, so a web deploy reaches Android without a new APK.
    // 应用始终打开线上成员网络，网页发布后安卓端无需重新安装即可更新。
    url: 'https://utmmsc.com',
    // The path stays out of url: Capacitor also uses url as the origin rule that keeps the plugin bridge in
    // utmmsc.com's main frame, and with a path in it Android exposes the bridge to every frame instead.
    // 路径不写进 url：Capacitor 也把 url 当作来源规则，把插件桥限制在 utmmsc.com 的主框架内；url 带路径时，安卓会把桥暴露给所有框架。
    appStartPath: '/UTMMSC/',
    androidScheme: 'https',
    // The bundled www/index.html is shown only when the live site cannot load.
    // 打包的 www/index.html 只在线上网站无法加载时显示。
    errorPath: 'index.html',
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    SystemBars: {
      insetsHandling: 'native',
      initialViewportFitValueHint: 'cover',
      // Dark bar icons, because the member network only has light headers.
      // 成员网络只有浅色顶栏，因此系统栏图标固定为深色。
      style: 'LIGHT',
    },
  },
};

export default config;
