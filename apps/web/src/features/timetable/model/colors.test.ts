import { describe, expect, it } from 'vitest';
import { COURSE_COLORS } from '@utmmsc/shared';
import { COURSE_PALETTE, courseColor, nextCourseColor } from './colors';

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

/** WCAG 2 contrast ratio between two opaque colours, as in wxTokens.test.ts. */
/** 两个不透明颜色之间的 WCAG 2 对比度，与 wxTokens.test.ts 相同。 */
function contrast(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe('course palette', () => {
  it('has a pair for every course colour', () => {
    expect(Object.keys(COURSE_PALETTE).sort()).toEqual([...COURSE_COLORS].sort());
  });

  it.each(COURSE_COLORS)('%s: ink reads on its fill and its border shows on white', (color) => {
    const { fill, ink } = courseColor(color);
    // The design's minimum is 6.74:1 rounded (lime, 6.737:1), well above the 4.5:1 that 11 px text needs.
    // 设计中的最低值 6.74:1 是四舍五入后的数（lime，6.737:1），远高于 11 px 文字所需的 4.5:1。
    expect(contrast(ink, fill)).toBeGreaterThanOrEqual(6.73);
    // A skipped class draws its text on white, and the 3 px left border must stand out from the grid.
    // 停课的课把文字画在白底上，3 px 的左边框也必须在课表上清楚可见。
    expect(contrast(ink, '#FFFFFF')).toBeGreaterThanOrEqual(7.67);
  });

  it('keeps the fills apart from one another', () => {
    const fills = new Set(COURSE_COLORS.map((color) => courseColor(color).fill));
    expect(fills.size).toBe(COURSE_COLORS.length);
  });
});

describe('nextCourseColor', () => {
  it('takes the first unused colour, then the least used one', () => {
    expect(nextCourseColor([])).toBe('purple');
    expect(nextCourseColor([{ color: 'purple' }, { color: 'blue' }])).toBe('gold');
    const all = COURSE_COLORS.map((color) => ({ color }));
    expect(nextCourseColor(all)).toBe('purple');
    expect(nextCourseColor([...all, { color: 'purple' }])).toBe('gold');
  });
});
