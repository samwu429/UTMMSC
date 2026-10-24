import { forwardRef, type CSSProperties, type ReactNode } from 'react';
import { useTr } from '../../../shared/i18n/locale';
import { HEADER_PROGRESS_VAR } from '../hooks/useHeaderProgress';
import { BackIcon } from '../icons';

export interface MomentsHeaderProps {
  title: string;
  /** Where back returns, shown beside the chevron: 发现 on the home feed. Empty for the chevron alone, named plain 返回. */
  /** 返回到哪里，显示在箭头旁：动态首页为「发现」。为空时只显示箭头，按钮名称为「返回」。 */
  backLabel: string;
  onBack(): void;
  /** Right side: the camera on the home feed, ··· on the album and the detail page. */
  /** 右侧：动态首页为相机，相册和详情页为「···」。 */
  trailing?: ReactNode;
  /**
   * cover: transparent with white icons over a cover, turning solid as useHeaderProgress writes --header-p to
   * this element. solid: always solid, for pages without a cover.
   * cover：覆盖在封面上方时透明、图标为白色，随 useHeaderProgress 写入本元素的 --header-p 变为不透明。solid：始终不透明，用于没有封面的页面。
   */
  variant?: 'cover' | 'solid';
  /** Tapping the title once the header is solid; the home feed scrolls back to the top. */
  /** 顶栏不透明后轻触标题；动态首页会滚回顶部。 */
  onTitleClick?(): void;
  /** Hidden while the composer replaces the page; it stays mounted so the progress ref holds. */
  /** 编辑器替换页面期间隐藏；仍保持挂载，进度所用的 ref 才不会失效。 */
  hidden?: boolean;
}

// White (255) over the cover, wx-ink (25) once solid.
// 在封面上为白色（255），不透明后为 wx-ink（25）。
const CHANNEL = `calc(255 - 230 * var(${HEADER_PROGRESS_VAR}, 1))`;

const BAR: CSSProperties = {
  top: 'var(--safe-top)',
  paddingLeft: 'var(--safe-left)',
  paddingRight: 'var(--safe-right)',
  backgroundColor: `rgba(237, 237, 237, var(${HEADER_PROGRESS_VAR}, 1))`,
  borderBottomColor: `rgba(224, 224, 224, var(${HEADER_PROGRESS_VAR}, 1))`,
  color: `rgb(${CHANNEL}, ${CHANNEL}, ${CHANNEL})`,
};

const SOLID: CSSProperties = { ...BAR, [HEADER_PROGRESS_VAR]: 1 } as CSSProperties;

/** The white icons keep a soft shadow over bright covers; it fades with the header. */
/** 白色图标在明亮的封面上带有柔和的阴影；阴影随顶栏一起淡出。 */
const CONTROL_SHADOW: CSSProperties = {
  filter: `drop-shadow(0 1px 1.5px rgba(0, 0, 0, calc(0.5 * (1 - var(${HEADER_PROGRESS_VAR}, 1)))))`,
};

/**
 * The fixed 44px moments header under the status bar: back「‹ 发现」, the title, and the trailing control. Over
 * a cover it starts transparent with shadowed white icons and lets taps through to the cover; the title fades
 * in and the bar turns solid wx-canvas as the cover scrolls under it. A tap on the solid title calls
 * onTitleClick. Shared by the home feed and the secondary moments pages.
 * 状态栏下方固定的 44px 动态顶栏：返回「‹ 发现」、标题和右侧控件。在封面上方时一开始是透明的，白色图标带阴影，点按会穿透到封面；
 * 封面滚到它下面时，标题渐显，顶栏变为不透明的 wx-canvas。轻触不透明状态下的标题会调用 onTitleClick。动态首页和动态次级页面共用。
 */
export const MomentsHeader = forwardRef<HTMLElement, MomentsHeaderProps>(function MomentsHeader(
  { title, backLabel, onBack, trailing, variant = 'cover', onTitleClick, hidden = false },
  ref,
) {
  const tr = useTr();
  const solid = variant === 'solid';

  return (
    <header
      ref={ref}
      hidden={hidden}
      data-solid={solid ? 'true' : 'false'}
      className="group pointer-events-none fixed inset-x-0 z-30 border-b-[0.5px] data-[solid=true]:pointer-events-auto"
      style={solid ? SOLID : BAR}
    >
      <div className="relative mx-auto flex h-11 max-w-2xl items-center">
        <button
          type="button"
          onClick={onBack}
          aria-label={backLabel ? tr(`返回${backLabel}`, `Back to ${backLabel}`) : tr('返回', 'Back')}
          className="pointer-events-auto relative z-10 flex h-11 min-w-11 items-center gap-0.5 pl-1.5 pr-3 text-[17px] leading-none active:opacity-60"
          style={CONTROL_SHADOW}
        >
          <BackIcon className="h-6 w-6 shrink-0" />
          {backLabel ? <span aria-hidden>{backLabel}</span> : null}
        </button>
        <h1 className="pointer-events-none absolute inset-y-0 left-24 right-24 flex items-center justify-center" style={{ opacity: `var(${HEADER_PROGRESS_VAR}, 1)` }}>
          {onTitleClick ? (
            <button
              type="button"
              onClick={onTitleClick}
              className="pointer-events-none flex h-11 max-w-full items-center truncate px-2 text-[17px] font-semibold group-data-[solid=true]:pointer-events-auto"
            >
              <span className="truncate">{title}</span>
            </button>
          ) : (
            <span className="truncate text-[17px] font-semibold">{title}</span>
          )}
        </h1>
        {trailing ? (
          <div className="pointer-events-auto relative z-10 ml-auto flex items-center pr-1" style={CONTROL_SHADOW}>
            {trailing}
          </div>
        ) : null}
      </div>
    </header>
  );
});
