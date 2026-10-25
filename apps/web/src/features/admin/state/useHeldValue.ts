import { useState } from 'react';

/**
 * The last value seen, kept while `holding`: an item stays on screen while the decision that takes it out of its
 * list is on the way, instead of flashing a "not found" state before the screen moves on.
 * 保留最近一次看到的值（`holding` 期间）：在把某一项移出列表的决定发出期间，它仍显示在屏幕上，而不会在界面离开之前闪现「找不到」的状态。
 */
export function useHeldValue<T>(live: T | undefined, holding: boolean): T | undefined {
  const [shown, setShown] = useState(live);
  if (live !== undefined && live !== shown) setShown(live);
  return live ?? (holding ? shown : undefined);
}
