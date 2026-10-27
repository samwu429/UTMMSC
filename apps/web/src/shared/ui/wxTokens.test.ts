import { describe, expect, it } from 'vitest';
import { WX_COLORS } from './wxTokens';

/** brand-700 from tailwind.config.ts, used for links and pills on white. */
/** tailwind.config.ts 中的 brand-700，用于白底上的链接和浮标。 */
const BRAND_700 = '#5B2A86';
/** brand-50, the fill behind the 群聊 tag in the chat list. */
/** brand-50，聊天列表里「群聊」标签的底色。 */
const BRAND_50 = '#F4EEF8';
const WHITE = '#FFFFFF';

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function rgb(hex: string): number[] {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) throw new Error(`not a #rrggbb colour: ${hex}`);
  return match.slice(1).map((part) => Number.parseInt(part, 16));
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((value) => channel(value));
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

/** WCAG 2 contrast ratio between two opaque colours. */
/** 两个不透明颜色之间的 WCAG 2 对比度。 */
function contrast(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** `top` drawn at `alpha` over the opaque `below`, blended per channel as browsers do, as an opaque colour. */
/** 以 `alpha` 不透明度画在不透明的 `below` 之上的 `top`，与浏览器一样逐通道混合，结果为不透明颜色。 */
function over(top: string, alpha: number, below: string): string {
  const base = rgb(below);
  const mixed = rgb(top).map((value, i) => Math.round(value * alpha + (base[i] ?? 0) * (1 - alpha)));
  return `#${mixed.map((value) => value.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

/**
 * The sticker preview's backdrop (bg-black/70) over pure white, where its light text is weakest. White is the bound
 * whatever the bubble colours become, since a photo or sticker in the chat behind it can be white too.
 * 表情预览的背景（bg-black/70）叠在纯白之上，其上的浅色文字在这里最弱。无论气泡颜色以后如何变化，纯白都是上限，
 * 因为背后聊天中的图片或表情也可能是白色的。
 */
const PREVIEW_BACKDROP = over('#000000', 0.7, WHITE);

const PAIRS: [label: string, foreground: string, background: string][] = [
  ['ink on mine', WX_COLORS.ink, WX_COLORS.mine],
  ['ink on minePressed', WX_COLORS.ink, WX_COLORS.minePressed],
  ['ink on other', WX_COLORS.ink, WX_COLORS.other],
  ['ink on canvas', WX_COLORS.ink, WX_COLORS.canvas],
  ['meta on canvas', WX_COLORS.meta, WX_COLORS.canvas],
  ['meta on bar', WX_COLORS.meta, WX_COLORS.bar],
  ['meta on white', WX_COLORS.meta, WHITE],
  ['link on canvas', WX_COLORS.link, WX_COLORS.canvas],
  ['link on white', WX_COLORS.link, WHITE],
  // Names and 展开其余 N 条评论 in the likes and comments box of 好友动态.
  // 好友动态赞和评论区中的名字与「展开其余 N 条评论」。
  ['link on bar', WX_COLORS.link, WX_COLORS.bar],
  // A pressed comment row or name, which stays pressed while its menu is open.
  // 按下的评论行或名字；菜单打开期间保持按下的颜色。
  ['link on pressed', WX_COLORS.link, WX_COLORS.pressed],
  ['white on red', WHITE, WX_COLORS.red],
  ['red on white', WX_COLORS.red, WHITE],
  ['white on popover', WHITE, WX_COLORS.popover],
  ['quoteInk on quote', WX_COLORS.quoteInk, WX_COLORS.quote],
  // The gray tile of a sticker that failed to load: 加载失败，点按重试 and 这个表情已失效.
  // 加载失败的表情显示的灰色图块：「加载失败，点按重试」和「这个表情已失效」。
  ['quoteInk on line', WX_COLORS.quoteInk, WX_COLORS.line],
  ['brand-700 on white', BRAND_700, WHITE],
  ['brand-700 on brand-50', BRAND_700, BRAND_50],
  // The gray 已添加 in the sticker preview (text-white/75) over its backdrop.
  // 表情预览中灰色的「已添加」（text-white/75）在背景之上。
  ['white/75 over black/70', over(WHITE, 0.75, PREVIEW_BACKDROP), PREVIEW_BACKDROP],
  // The preview's failure tile (加载失败，点按重试 and 这个表情已失效) and 播放 / 暂停: white on bg-white/15 over the backdrop.
  // 预览中加载失败的图块（「加载失败，点按重试」和「这个表情已失效」）以及「播放 / 暂停」：背景上叠 bg-white/15，配白色文字。
  ['white on white/15 over black/70', WHITE, over(WHITE, 0.15, PREVIEW_BACKDROP)],
];

describe('contrast', () => {
  it('matches known reference values', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2);
  });

  it('blends a translucent colour over an opaque one', () => {
    expect(over('#000000', 0.5, '#FFFFFF')).toBe('#808080');
    expect(over('#000000', 0.7, '#FFFFFF')).toBe('#4D4D4D');
    expect(over('#FFFFFF', 1, '#123456')).toBe('#FFFFFF');
    expect(over('#FFFFFF', 0, '#123456')).toBe('#123456');
  });

  // The backdrop pairs are only as strict as their surface; this keeps them strict enough to fail the old values.
  // 背景上的配色只和所选的底色一样严格；这里确保它们严格到足以让旧值不通过。
  it('fails the preview text as it was drawn before (white/60, and white/80 on the failure tile)', () => {
    expect(contrast(over(WHITE, 0.6, PREVIEW_BACKDROP), PREVIEW_BACKDROP)).toBeLessThan(4.5);
    expect(contrast(over(WHITE, 0.8, over(WHITE, 0.15, PREVIEW_BACKDROP)), over(WHITE, 0.15, PREVIEW_BACKDROP))).toBeLessThan(4.5);
  });

  it.each(PAIRS)('%s reaches 4.5:1', (_label, foreground, background) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('WX_COLORS', () => {
  it('holds only #rrggbb values', () => {
    for (const value of Object.values(WX_COLORS)) expect(value).toMatch(/^#[0-9A-F]{6}$/);
  });
});
