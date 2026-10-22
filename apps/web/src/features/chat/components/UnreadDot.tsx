/**
 * WeChat red badge: a pill with the count (99+ at most), or a 10px dot for muted and marked chats.
 * Nothing renders for zero. It is decorative; callers put the spoken count in their own label.
 * 微信式红色角标：显示数字的胶囊（最多 99+），免打扰或标为未读时为 10px 小红点。为 0 时不渲染。
 * 它只是视觉标记；读屏文字由调用方写在自己的标签里。
 */
export function UnreadDot({ count = 0, dot = false, className = '' }: { count?: number; dot?: boolean; className?: string }) {
  if (count > 0) {
    return (
      <span
        aria-hidden
        className={`inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-wx-red px-[5px] text-[12px] font-bold leading-none text-white ${className}`}
      >
        {count > 99 ? '99+' : count}
      </span>
    );
  }
  if (!dot) return null;
  return <span aria-hidden className={`inline-block h-2.5 w-2.5 rounded-full bg-wx-red ${className}`} />;
}
