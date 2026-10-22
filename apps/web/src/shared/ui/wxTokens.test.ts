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

function luminance(hex: string): number {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) throw new Error(`not a #rrggbb colour: ${hex}`);
  const [r, g, b] = match.slice(1).map((part) => channel(Number.parseInt(part, 16)));
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

/** WCAG 2 contrast ratio between two opaque colours. */
/** 两个不透明颜色之间的 WCAG 2 对比度。 */
function contrast(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

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
  ['white on red', WHITE, WX_COLORS.red],
  ['red on white', WX_COLORS.red, WHITE],
  ['white on popover', WHITE, WX_COLORS.popover],
  ['quoteInk on quote', WX_COLORS.quoteInk, WX_COLORS.quote],
  ['brand-700 on white', BRAND_700, WHITE],
  ['brand-700 on brand-50', BRAND_700, BRAND_50],
];

describe('contrast', () => {
  it('matches known reference values', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2);
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
