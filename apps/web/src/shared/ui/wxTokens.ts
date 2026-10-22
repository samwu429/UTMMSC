/**
 * Chat colours modelled on WeChat, exposed to Tailwind as `wx-*` (for example bg-wx-canvas).
 * Every text pairing used by the chat screens is checked for 4.5:1 contrast in wxTokens.test.ts.
 * 仿照微信的聊天配色，以 `wx-*` 提供给 Tailwind（例如 bg-wx-canvas）。
 * 聊天界面用到的每组文字配色都在 wxTokens.test.ts 中校验 4.5:1 对比度。
 */
export const WX_COLORS = {
  canvas: '#EDEDED',
  bar: '#F7F7F7',
  line: '#E0E0E0',
  ink: '#191919',
  /** Names, times, tips and previews; still 4.5:1 on canvas. */
  /** 名字、时间、提示和预览；在 canvas 上仍达到 4.5:1。 */
  meta: '#6B6B6B',
  link: '#576B95',
  /** Badge red. WeChat's #FA5151 fails 4.5:1 under white 12px text. */
  /** 角标红。微信的 #FA5151 配白色 12px 文字达不到 4.5:1。 */
  red: '#D93025',
  pressed: '#ECECEC',
  popover: '#4C4C4C',
  other: '#FFFFFF',
  otherPressed: '#EBEBEB',
  /**
   * Own bubbles use a tint of the club gold. WeChat green is #95EC69 with #89D961 pressed; swapping
   * these two values is the whole change.
   * 自己的气泡使用社团金色的浅色调。微信绿为 #95EC69，按下为 #89D961；只需替换这两个值。
   */
  mine: '#FFE27A',
  minePressed: '#F2D35C',
  quote: '#E2E2E2',
  quoteInk: '#5E5E5E',
  pinned: '#F7F7F7',
} as const;

export type WxColor = keyof typeof WX_COLORS;
