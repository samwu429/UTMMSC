/**
 * The strip behind the system status bar on edge-to-edge screens (the Android app, the iOS home-screen
 * app). Its height is the top safe-area inset, so it is invisible elsewhere; screens pick its colour
 * with useStatusBarColor.
 * 全面屏（安卓应用、iOS 主屏幕应用）上衬在系统状态栏后面的色条。高度等于顶部安全区，其他环境下不可见；颜色由各界面通过 useStatusBarColor 设置。
 */
export function StatusBarScrim() {
  return <div className="status-bar-scrim" aria-hidden />;
}
