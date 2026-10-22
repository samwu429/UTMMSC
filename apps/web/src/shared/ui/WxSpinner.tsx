import { useTr } from '../i18n/locale';

const SPOKES = Array.from({ length: 12 }, (_, index) => ({
  angle: index * 30,
  // The spoke at 12 o'clock leads; the ones behind it fade out as the wheel turns clockwise.
  // 十二点方向的辐条最亮；顺时针转动时，后面的辐条依次变淡。
  opacity: 1 - (((12 - index) % 12) / 12) * 0.85,
}));

/**
 * Twelve-spoke gray activity indicator, the WeChat loading glyph. `label` overrides the spoken text.
 * 十二辐灰色加载指示器，即微信的加载图标。`label` 可替换读屏文字。
 */
export function WxSpinner({ size = 20, label, className = '' }: { size?: 16 | 20; label?: string; className?: string }) {
  const tr = useTr();
  return (
    <span role="status" aria-label={label ?? tr('加载中', 'Loading')} className={`inline-flex shrink-0 text-wx-meta ${className}`}>
      <svg viewBox="0 0 24 24" width={size} height={size} className="wx-spinner" aria-hidden>
        {SPOKES.map((spoke) => (
          <rect key={spoke.angle} x="11" y="2" width="2" height="6" rx="1" fill="currentColor" opacity={spoke.opacity} transform={`rotate(${spoke.angle} 12 12)`} />
        ))}
      </svg>
    </span>
  );
}
