import { useEffect, useLayoutEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Whether the screen that started some work is still the one shown, for work that navigates once a request answers.
 * The admin may have gone back, opened another row, or changed the address meanwhile; going back or replacing then
 * would act on an entry that is no longer this screen's, and could leave the section. Pure, so it is tested without
 * a browser.
 * 发起某项工作的界面是否仍在显示，用于请求答复后才跳转的工作。期间管理员可能已经返回、打开了另一行或改了地址；这时再返回或替换，
 * 作用的就是一条已经不属于这个界面的记录，可能直接离开这个板块。纯逻辑，无需浏览器即可测试。
 */
export class ScreenGuard {
  private key: string;
  private shown = false;

  constructor(key: string) {
    this.key = key;
  }

  /** The screen now shows the history entry `key`. */
  /** 界面现在显示的是历史记录 `key`。 */
  track(key: string): void {
    this.key = key;
  }

  enter(): void {
    this.shown = true;
  }

  leave(): void {
    this.shown = false;
  }

  /**
   * Called before the await. The check it returns stays true while this screen is mounted on the same entry.
   * 在 await 之前调用。返回的检查函数在这个界面仍挂载于同一条记录时为 true。
   */
  readonly begin = (): (() => boolean) => {
    const started = this.key;
    return () => this.shown && this.key === started;
  };
}

/**
 * The ScreenGuard of the calling screen. Call the result before an await, and navigate afterwards only when the
 * check it returns is still true; cache updates and toasts run either way.
 * 调用方界面的 ScreenGuard。在 await 之前调用返回的函数，之后只有当它给出的检查仍为 true 时才跳转；缓存更新和提示无论如何都执行。
 */
export function useScreenGuard(): () => () => boolean {
  const { key } = useLocation();
  const [guard] = useState(() => new ScreenGuard(key));
  useLayoutEffect(() => {
    guard.track(key);
  }, [guard, key]);
  // Set inside the effect, so StrictMode's second mount marks it shown again.
  // 在 effect 中设置，StrictMode 第二次挂载时会再次标为显示中。
  useEffect(() => {
    guard.enter();
    return () => guard.leave();
  }, [guard]);
  return guard.begin;
}
