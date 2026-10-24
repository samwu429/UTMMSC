import { useCallback, useEffect, useRef } from 'react';

/** The events that end a held press; a text-only composer opened from one may focus with the keyboard. */
/** 结束一次按住的事件；在其中打开的纯文字编辑器可以聚焦并弹出键盘。 */
export const RELEASE_EVENTS = ['touchend', 'pointerup', 'touchcancel', 'pointercancel'] as const;

/**
 * Calls `action` once, on the first of RELEASE_EVENTS that reaches `target` (in the capture phase). Returns the
 * function that stops waiting without calling it.
 * 在 RELEASE_EVENTS 中第一个到达 `target` 的事件（捕获阶段）中调用一次 `action`。返回的函数停止等待，且不再调用它。
 */
export function callOnRelease(target: EventTarget, action: () => void): () => void {
  const release = () => {
    detach();
    action();
  };
  // The options object rather than a bare true: Node's EventTarget does not match a boolean capture on removal.
  // 使用选项对象而不是单独的 true：Node 的 EventTarget 在移除监听时无法匹配布尔形式的 capture。
  const options: EventListenerOptions = { capture: true };
  const detach = () => {
    for (const type of RELEASE_EVENTS) target.removeEventListener(type, release, options);
  };
  for (const type of RELEASE_EVENTS) target.addEventListener(type, release, options);
  return detach;
}

/**
 * For a long press that opens the text composer. The long press fires from a timer while the finger is still
 * down, where iOS will not raise the keyboard, so the returned function puts the opening off to that press's
 * release, which is a user gesture. The latest `action` is the one called; a later arm replaces an earlier one,
 * and unmounting stops waiting.
 * 用于打开文字编辑器的长按。长按是在手指仍按着时由计时器触发的，iOS 在那时不会弹出键盘，因此返回的函数把打开推迟到这次按压松开时，
 * 松开属于用户手势。调用的是最新的 `action`；后一次等待会取代前一次，卸载时停止等待。
 */
export function useOpenOnRelease(action: () => void): () => void {
  const actionRef = useRef(action);
  const detachRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    actionRef.current = action;
  });

  useEffect(
    () => () => {
      detachRef.current?.();
      detachRef.current = null;
    },
    [],
  );

  return useCallback(() => {
    detachRef.current?.();
    detachRef.current = callOnRelease(window, () => {
      detachRef.current = null;
      actionRef.current();
    });
  }, []);
}
