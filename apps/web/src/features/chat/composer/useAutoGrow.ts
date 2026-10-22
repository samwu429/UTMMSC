import { useCallback, useEffect, useLayoutEffect, type RefObject } from 'react';

/**
 * Grows a textarea with its content from one line up to `maxLines`, then lets it scroll inside. Sizes come
 * from the element's own line height and padding, so the CSS stays the single source. Runs again when the
 * width changes, because rotating the phone rewraps the text.
 * 让文本框随内容从一行增高到 `maxLines` 行，之后在框内滚动。尺寸取自元素自身的行高和内边距，CSS 是唯一来源。
 * 宽度变化时重新计算，因为旋转手机会让文字重新换行。
 */
export function useAutoGrow(ref: RefObject<HTMLTextAreaElement>, value: string, { maxLines = 5, active = true }: { maxLines?: number; active?: boolean } = {}): void {
  const resize = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    const style = window.getComputedStyle(element);
    const lineHeight = parseFloat(style.lineHeight) || 22;
    const padding = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
    const border = (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0);
    const max = Math.round(lineHeight * maxLines + padding + border);
    const scrollTop = element.scrollTop;
    element.style.height = 'auto';
    const needed = element.scrollHeight + border;
    element.style.height = `${Math.min(needed, max)}px`;
    const overflowing = needed > max;
    element.style.overflowY = overflowing ? 'auto' : 'hidden';
    if (!overflowing) return;
    // Measuring at height auto resets the inner scroll; typing at the end follows the caret, otherwise the view stays put.
    // 以 auto 高度测量会重置内部滚动；在末尾输入时跟随光标，否则保持原来的位置。
    element.scrollTop = element.selectionEnd === element.value.length ? element.scrollHeight : scrollTop;
  }, [ref, maxLines]);

  useLayoutEffect(() => {
    if (active) resize();
  }, [active, resize, value]);

  useEffect(() => {
    const element = ref.current;
    if (!active || !element || typeof ResizeObserver === 'undefined') return;
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === width) return;
      width = element.clientWidth;
      resize();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [active, ref, resize]);
}
