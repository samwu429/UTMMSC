/**
 * Owner: T3, timetable web core. The 12 course colours: a light fill for the block and a dark ink for its text and
 * left border (minimum ink-on-fill contrast 6.74:1; colors.test.ts is T3's).
 * 维护者：T3，课表网页核心。12 种课程颜色：方块用浅色填充，文字和左边框用深色（深色在填充色上的最低对比度为 6.74:1；colors.test.ts 由 T3 编写）。
 */
import { COURSE_COLORS, type CourseColor, type TimetableCourse } from '@utmmsc/shared';

export interface CourseColorPair {
  fill: string;
  ink: string;
}

export const COURSE_PALETTE: Readonly<Record<CourseColor, CourseColorPair>> = {
  purple: { fill: '#EDE4F7', ink: '#4A1D78' },
  gold: { fill: '#FFF1C2', ink: '#6B4E00' },
  blue: { fill: '#DCEBFF', ink: '#0B4A8F' },
  green: { fill: '#DDF3E4', ink: '#14592F' },
  red: { fill: '#FDE2E1', ink: '#8A1C17' },
  teal: { fill: '#D6F1F0', ink: '#0D5552' },
  orange: { fill: '#FFE5CF', ink: '#7A3A00' },
  pink: { fill: '#FBE0EE', ink: '#82204F' },
  indigo: { fill: '#E1E4FB', ink: '#2E3A8C' },
  lime: { fill: '#ECF4D2', ink: '#475A0E' },
  brown: { fill: '#F0E6DC', ink: '#5E3B1C' },
  slate: { fill: '#E6E9ED', ink: '#33404D' },
};

export function courseColor(color: CourseColor): CourseColorPair {
  return COURSE_PALETTE[color];
}

/**
 * The colour a new course starts with: the first palette entry no course uses, or once all twelve are taken,
 * the least used one (palette order breaks ties).
 * 新课程的初始颜色：第一个还没有课程使用的颜色；十二种都用过之后，取使用最少的那个（相同时按色板顺序）。
 */
export function nextCourseColor(courses: readonly Pick<TimetableCourse, 'color'>[]): CourseColor {
  const uses = new Map<CourseColor, number>(COURSE_COLORS.map((color) => [color, 0]));
  for (const course of courses) uses.set(course.color, (uses.get(course.color) ?? 0) + 1);
  let best: CourseColor = COURSE_COLORS[0];
  for (const color of COURSE_COLORS) if ((uses.get(color) ?? 0) < (uses.get(best) ?? 0)) best = color;
  return best;
}
