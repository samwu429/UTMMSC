import { useLayoutEffect } from 'react';

const STATUS_BG = '--status-bg';

/**
 * Colours the status-bar strip to match the header under it while the calling screen is mounted, and
 * puts back the previous colour on unmount. Screens that set nothing get the page canvas.
 * 在调用它的界面挂载期间，让状态栏衬底与其下方的标题栏同色；卸载时恢复之前的颜色。未设置的界面使用页面底色。
 */
export function useStatusBarColor(color: string): void {
  useLayoutEffect(() => {
    const style = document.documentElement.style;
    const previous = style.getPropertyValue(STATUS_BG);
    style.setProperty(STATUS_BG, color);
    return () => {
      if (previous) style.setProperty(STATUS_BG, previous);
      else style.removeProperty(STATUS_BG);
    };
  }, [color]);
}
